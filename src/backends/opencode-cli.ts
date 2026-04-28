import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import type { AgentDefinition } from "../schemas/index.js";
import type {
  AgentResponse,
  BackendAdapter,
  BackendDispatchOptions,
} from "./index.js";
import { extractAgentOutputJson } from "./json-output.js";
import { joinPromptSections, resolveAgentPrompt } from "./shared.js";

const OPENCODE_NO_TOOLS_CONFIG = JSON.stringify({
  permission: {
    "*": "deny",
  },
});

const OPENCODE_BANNER_PREFIXES = [
  "opencode v",
  "OpenCode v",
  "session:",
  "model:",
  "agent:",
  "mode:",
  "provider:",
  "tokens used",
  "share url",
];

async function ensureOpenCodeWorkdir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "swarm-opencode-workdir-"));
}

export function composeOpenCodePrompt(
  persona: string,
  promptBody: string,
  brief: string,
): string {
  return joinPromptSections(
    persona,
    promptBody,
    "Do not modify files, run commands, or use tools. Reply with only the JSON object that satisfies the swarm contract.",
    "Use the following swarm brief to ground your response.",
    brief,
  );
}

export function normalizeOpenCodeStderr(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !OPENCODE_BANNER_PREFIXES.some((prefix) => line.startsWith(prefix)),
    );

  if (lines.length === 0) {
    return stderr.trim();
  }

  return lines.join("\n");
}

export class OpenCodeCliAdapter implements BackendAdapter {
  readonly wrapperName = "opencode-cli";

  extractOutputJson(raw: string): unknown {
    return extractAgentOutputJson(raw);
  }

  formatFailure(response: AgentResponse): string {
    if (response.timedOut) {
      return `Agent timed out after ${response.durationMs}ms`;
    }

    const detail =
      normalizeOpenCodeStderr(response.stderr) ||
      response.stdout.trim() ||
      "opencode run failed without stderr output";
    return `Agent exited with code ${response.exitCode}: ${detail}`;
  }

  async dispatch(
    brief: string,
    agent: AgentDefinition,
    opts: BackendDispatchOptions,
  ): Promise<AgentResponse> {
    const promptBody = await resolveAgentPrompt(agent);
    const prompt = composeOpenCodePrompt(agent.persona, promptBody, brief);
    const workdir = await ensureOpenCodeWorkdir();

    const args: string[] = ["run"];
    if (typeof agent.model === "string" && agent.model.length > 0) {
      args.push("--model", agent.model);
    }
    const start = performance.now();
    try {
      const result = await execa("opencode", args, {
        cwd: workdir,
        env: {
          ...process.env,
          OPENCODE_CONFIG_CONTENT: OPENCODE_NO_TOOLS_CONFIG,
        },
        input: prompt,
        timeout: opts.timeoutMs,
        reject: false,
      });
      const durationMs = Math.round(performance.now() - start);

      return {
        ok: result.exitCode === 0,
        exitCode: result.exitCode ?? 1,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        durationMs,
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }
}
