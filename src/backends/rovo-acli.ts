import { execa } from "execa";
import type { AgentDefinition } from "../schemas/index.js";
import type { AgentResponse, BackendAdapter } from "./index.js";
import { extractAgentOutputJson } from "./json-output.js";
import { joinPromptSections, resolveAgentPrompt } from "./shared.js";

const ROVO_BANNER_PREFIXES = [
  "Atlassian acli",
  "acli ",
  "Rovo Dev",
  "rovodev",
  "Session ",
  "session:",
  "Workspace:",
  "workspace:",
  "Model:",
  "model:",
  "Provider:",
  "provider:",
  "Tokens used",
  "tokens used",
  "Token usage",
  "token usage",
  "Shadow mode",
  "shadow mode",
];

export function composeRovoPrompt(
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

export function normalizeRovoStderr(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) => !ROVO_BANNER_PREFIXES.some((prefix) => line.startsWith(prefix)),
    );

  if (lines.length === 0) {
    return stderr.trim();
  }

  return lines.join("\n");
}

export class RovoAcliAdapter implements BackendAdapter {
  readonly wrapperName = "rovo-acli";

  extractOutputJson(raw: string): unknown {
    return extractAgentOutputJson(raw);
  }

  formatFailure(response: AgentResponse): string {
    if (response.timedOut) {
      return `Agent timed out after ${response.durationMs}ms`;
    }

    const detail =
      normalizeRovoStderr(response.stderr) ||
      response.stdout.trim() ||
      "acli rovodev run failed without stderr output";
    return `Agent exited with code ${response.exitCode}: ${detail}`;
  }

  async dispatch(
    brief: string,
    agent: AgentDefinition,
    opts: { timeoutMs: number },
  ): Promise<AgentResponse> {
    const promptBody = await resolveAgentPrompt(agent);
    const prompt = composeRovoPrompt(agent.persona, promptBody, brief);

    const args: string[] = ["rovodev", "run", "--shadow", "-y"];
    if (typeof agent.model === "string" && agent.model.length > 0) {
      args.push("--model", agent.model);
    }
    args.push(prompt);

    const start = performance.now();
    const result = await execa("acli", args, {
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
  }
}
