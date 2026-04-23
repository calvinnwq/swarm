import { execa } from "execa";
import type { BackendId } from "../schemas/backend-id.js";

const PROBE_TIMEOUT_MS = 5_000;

export interface BackendCapabilityCheck {
  name: "backend capability";
  status: "ok" | "fail";
  message: string;
  detail?: string;
}

export async function checkBackendCapability(
  backend: BackendId,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<BackendCapabilityCheck> {
  switch (backend) {
    case "claude":
      return await checkClaudeCapability(options.env);
    case "codex":
      return await checkCodexCapability(options.env);
  }
}

async function checkClaudeCapability(
  env: NodeJS.ProcessEnv | undefined,
): Promise<BackendCapabilityCheck> {
  const result = await runProbe("claude", ["auth", "status"], env, {
    missingBinaryMessage:
      'backend "claude" is not runnable: install Claude Code and ensure `claude` is available on PATH',
  });
  if ("check" in result) {
    return result.check;
  }

  if (isMissingBinaryResult(result)) {
    return {
      name: "backend capability",
      status: "fail",
      message:
        'backend "claude" is not runnable: install Claude Code and ensure `claude` is available on PATH',
    };
  }

  if (result.exitCode !== 0) {
    return {
      name: "backend capability",
      status: "fail",
      message:
        'backend "claude" is not authenticated: run `claude auth login` and retry',
      detail: formatProbeDetail(result.stdout, result.stderr),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return {
      name: "backend capability",
      status: "fail",
      message:
        'backend "claude" is not authenticated: run `claude auth login` and retry',
      detail: formatProbeDetail(result.stdout, result.stderr),
    };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("loggedIn" in parsed) ||
    parsed.loggedIn !== true
  ) {
    return {
      name: "backend capability",
      status: "fail",
      message:
        'backend "claude" is not authenticated: run `claude auth login` and retry',
      detail: formatProbeDetail(result.stdout, result.stderr),
    };
  }

  return {
    name: "backend capability",
    status: "ok",
    message: 'backend "claude" is installed and authenticated',
  };
}

async function checkCodexCapability(
  env: NodeJS.ProcessEnv | undefined,
): Promise<BackendCapabilityCheck> {
  const result = await runProbe("codex", ["login", "status"], env, {
    missingBinaryMessage:
      'backend "codex" is not runnable: install the Codex CLI and ensure `codex` is available on PATH',
  });
  if ("check" in result) {
    return result.check;
  }

  if (isMissingBinaryResult(result)) {
    return {
      name: "backend capability",
      status: "fail",
      message:
        'backend "codex" is not runnable: install the Codex CLI and ensure `codex` is available on PATH',
    };
  }

  if (result.exitCode !== 0 || !/^Logged in\b/m.test(result.stdout)) {
    return {
      name: "backend capability",
      status: "fail",
      message:
        'backend "codex" is not authenticated: run `codex login` and retry',
      detail: formatProbeDetail(result.stdout, result.stderr),
    };
  }

  return {
    name: "backend capability",
    status: "ok",
    message: 'backend "codex" is installed and authenticated',
  };
}

async function runProbe(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv | undefined,
  options: { missingBinaryMessage: string },
): Promise<
  | { check: BackendCapabilityCheck }
  | { exitCode: number; stdout: string; stderr: string }
> {
  try {
    const result = await execa(command, args, {
      env,
      reject: false,
      timeout: PROBE_TIMEOUT_MS,
    });

    if ("code" in result && result.code === "ENOENT") {
      return {
        check: {
          name: "backend capability",
          status: "fail",
          message: options.missingBinaryMessage,
        },
      };
    }

    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    if (isMissingBinaryError(error)) {
      return {
        check: {
          name: "backend capability",
          status: "fail",
          message: options.missingBinaryMessage,
        },
      };
    }

    if (isTimedOutError(error)) {
      return {
        check: {
          name: "backend capability",
          status: "fail",
          message: `backend "${command}" is not responding: timed out after ${PROBE_TIMEOUT_MS}ms`,
        },
      };
    }

    throw error;
  }
}

function isMissingBinaryError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isTimedOutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "timedOut" in error &&
    error.timedOut === true
  );
}

function isMissingBinaryResult(result: {
  exitCode: number;
  stdout: string;
  stderr: string;
}): boolean {
  const text = `${result.stdout}\n${result.stderr}`;
  return (
    result.exitCode === 127 ||
    /\bENOENT\b/.test(text) ||
    /command not found/i.test(text) ||
    /\bnot found\b/i.test(text)
  );
}

function formatProbeDetail(stdout: string, stderr: string): string | undefined {
  const chunks = [stdout.trim(), stderr.trim()].filter(Boolean);
  if (chunks.length === 0) {
    return undefined;
  }
  return chunks.join("\n");
}
