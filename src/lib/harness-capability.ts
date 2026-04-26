import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import type { HarnessId } from "../schemas/harness-id.js";
import {
  getHarnessDescriptor,
  type HarnessDescriptor,
} from "./harness-registry.js";

const PROBE_TIMEOUT_MS = 5_000;
const CODEX_EXEC_PROBE_ARGS = [
  "exec",
  "--ephemeral",
  "--ignore-rules",
  "--skip-git-repo-check",
  "-C",
  ".",
  "-c",
  'reasoning_effort="none"',
  "--sandbox",
  "read-only",
  "--color",
  "never",
  "--output-schema",
] as const;

let codexDoctorSchemaPathPromise: Promise<string> | null = null;

export interface HarnessCapabilityCheck {
  name: "harness capability";
  status: "ok" | "fail";
  message: string;
  detail?: string;
}

export async function checkHarnessCapability(
  harness: HarnessId,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<HarnessCapabilityCheck> {
  const descriptor = getHarnessDescriptor(harness);
  switch (harness) {
    case "claude":
      return await checkClaudeHarness(descriptor, options.env);
    case "codex":
      return await checkCodexHarness(descriptor, options.env);
    case "opencode":
    case "rovo":
      return await checkRegistryDrivenHarness(descriptor, options.env);
  }
}

async function checkClaudeHarness(
  descriptor: HarnessDescriptor,
  env: NodeJS.ProcessEnv | undefined,
): Promise<HarnessCapabilityCheck> {
  const result = await runProbe(
    descriptor.command.bin,
    descriptor.capability.authProbeArgs,
    env,
    {
      harness: descriptor.id,
      missingBinaryMessage: missingBinaryMessage(descriptor),
    },
  );
  if ("check" in result) {
    return result.check;
  }

  if (result.exitCode !== 0) {
    return notAuthenticated(descriptor, result);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return notAuthenticated(descriptor, result);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("loggedIn" in parsed) ||
    parsed.loggedIn !== true
  ) {
    return notAuthenticated(descriptor, result);
  }

  return ok(descriptor);
}

async function checkCodexHarness(
  descriptor: HarnessDescriptor,
  env: NodeJS.ProcessEnv | undefined,
): Promise<HarnessCapabilityCheck> {
  const loginResult = await runProbe(
    descriptor.command.bin,
    descriptor.capability.authProbeArgs,
    env,
    {
      harness: descriptor.id,
      missingBinaryMessage: missingBinaryMessage(descriptor),
    },
  );
  if ("check" in loginResult) {
    return loginResult.check;
  }

  if (loginResult.exitCode !== 0) {
    return notAuthenticated(descriptor, loginResult);
  }

  let schemaPath: string;
  try {
    schemaPath = await ensureCodexDoctorSchemaPath();
  } catch (error) {
    return {
      name: "harness capability",
      status: "fail",
      message: `harness "${descriptor.id}" is not runnable: failed to prepare \`codex exec\` probe`,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const execResult = await runProbe(
    descriptor.command.bin,
    [...CODEX_EXEC_PROBE_ARGS, schemaPath, "-", "--help"],
    env,
    {
      harness: descriptor.id,
      missingBinaryMessage: missingBinaryMessage(descriptor),
    },
  );
  if ("check" in execResult) {
    return execResult.check;
  }

  if (execResult.exitCode !== 0) {
    return {
      name: "harness capability",
      status: "fail",
      message: `harness "${descriptor.id}" is not runnable: installed CLI is missing required \`codex exec\` support`,
      detail: formatProbeDetail(execResult.stdout, execResult.stderr),
    };
  }

  return ok(descriptor);
}

async function checkRegistryDrivenHarness(
  descriptor: HarnessDescriptor,
  env: NodeJS.ProcessEnv | undefined,
): Promise<HarnessCapabilityCheck> {
  const authResult = await runProbe(
    descriptor.command.bin,
    descriptor.capability.authProbeArgs,
    env,
    {
      harness: descriptor.id,
      missingBinaryMessage: missingBinaryMessage(descriptor),
    },
  );
  if ("check" in authResult) {
    return authResult.check;
  }

  if (authResult.exitCode !== 0) {
    if (descriptor.capability.verifiesAuth === false) {
      return {
        name: "harness capability",
        status: "fail",
        message: `harness "${descriptor.id}" is not runnable: installed CLI rejected the capability probe`,
        detail: formatProbeDetail(authResult.stdout, authResult.stderr),
      };
    }

    return notAuthenticated(descriptor, authResult);
  }

  if (descriptor.capability.runtimeProbeArgs) {
    const runtimeResult = await runProbe(
      descriptor.command.bin,
      descriptor.capability.runtimeProbeArgs,
      env,
      {
        harness: descriptor.id,
        missingBinaryMessage: missingBinaryMessage(descriptor),
      },
    );
    if ("check" in runtimeResult) {
      return runtimeResult.check;
    }

    if (runtimeResult.exitCode !== 0) {
      return {
        name: "harness capability",
        status: "fail",
        message: `harness "${descriptor.id}" is not runnable: installed CLI rejected the runtime probe`,
        detail: formatProbeDetail(runtimeResult.stdout, runtimeResult.stderr),
      };
    }
  }

  return ok(descriptor);
}

async function runProbe(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv | undefined,
  options: { harness: HarnessId; missingBinaryMessage: string },
): Promise<
  | { check: HarnessCapabilityCheck }
  | { exitCode: number; stdout: string; stderr: string }
> {
  try {
    const result = await execa(command, args as string[], {
      env,
      reject: false,
      timeout: PROBE_TIMEOUT_MS,
    });

    if (isTimedOutResult(result)) {
      return {
        check: {
          name: "harness capability",
          status: "fail",
          message: `harness "${options.harness}" is not responding: timed out after ${PROBE_TIMEOUT_MS}ms`,
        },
      };
    }

    if ("code" in result && result.code === "ENOENT") {
      return {
        check: {
          name: "harness capability",
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
          name: "harness capability",
          status: "fail",
          message: options.missingBinaryMessage,
        },
      };
    }

    if (isTimedOutError(error)) {
      return {
        check: {
          name: "harness capability",
          status: "fail",
          message: `harness "${options.harness}" is not responding: timed out after ${PROBE_TIMEOUT_MS}ms`,
        },
      };
    }

    throw error;
  }
}

function ok(descriptor: HarnessDescriptor): HarnessCapabilityCheck {
  const status =
    descriptor.capability.verifiesAuth === false
      ? "is installed and runnable"
      : "is installed and authenticated";

  return {
    name: "harness capability",
    status: "ok",
    message: `harness "${descriptor.id}" ${status}`,
  };
}

function notAuthenticated(
  descriptor: HarnessDescriptor,
  probe: { stdout: string; stderr: string },
): HarnessCapabilityCheck {
  return {
    name: "harness capability",
    status: "fail",
    message: `harness "${descriptor.id}" is not authenticated: ${descriptor.capability.missingAuthHint}`,
    detail: formatProbeDetail(probe.stdout, probe.stderr),
  };
}

function missingBinaryMessage(descriptor: HarnessDescriptor): string {
  return `harness "${descriptor.id}" is not runnable: ${descriptor.capability.missingBinHint}`;
}

async function ensureCodexDoctorSchemaPath(): Promise<string> {
  if (!codexDoctorSchemaPathPromise) {
    codexDoctorSchemaPathPromise = (async () => {
      const filePath = join(tmpdir(), "swarm-codex-doctor-output.schema.json");
      await writeFile(filePath, '{"type":"object"}\n', "utf-8");
      return filePath;
    })().catch((error) => {
      codexDoctorSchemaPathPromise = null;
      throw error;
    });
  }

  return await codexDoctorSchemaPathPromise;
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

function isTimedOutResult(result: unknown): result is { timedOut: true } {
  return (
    typeof result === "object" &&
    result !== null &&
    "timedOut" in result &&
    result.timedOut === true
  );
}

function formatProbeDetail(stdout: string, stderr: string): string | undefined {
  const chunks = [stdout.trim(), stderr.trim()].filter(Boolean);
  if (chunks.length === 0) {
    return undefined;
  }
  return chunks.join("\n");
}
