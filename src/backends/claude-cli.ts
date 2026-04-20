import { readFile } from "node:fs/promises";
import { execa } from "execa";
import { AgentOutputSchema } from "../schemas/index.js";
import type { AgentDefinition, AgentOutput } from "../schemas/index.js";
import type { AgentResponse, BackendAdapter } from "./index.js";

/**
 * Extract JSON from Claude CLI output that may contain markdown fences,
 * leading prose, or trailing junk. Mirrors the reference Python
 * `parse_agent_output` behavior.
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();

  // 1. Try parsing the whole string as JSON first.
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  // 2. Look for fenced JSON blocks: ```json ... ``` or ``` ... ```
  const fenceRe = /```(?:json)?\s*\n([\s\S]*?)```/;
  const fenceMatch = fenceRe.exec(trimmed);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // fall through
    }
  }

  // 3. Find the outermost { ... } pair, tolerating leading/trailing prose.
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace !== -1) {
    const lastBrace = trimmed.lastIndexOf("}");
    if (lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        // fall through
      }
    }
  }

  return undefined;
}

/**
 * Parse raw CLI output into a validated AgentOutput.
 * Throws a descriptive error when extraction or validation fails.
 */
export function parseAgentOutput(raw: string): AgentOutput {
  const json = extractJson(raw);
  if (json === undefined) {
    throw new Error(
      `Failed to extract JSON from agent output.\n--- raw stdout ---\n${raw}\n--- end ---`,
    );
  }
  return AgentOutputSchema.parse(json);
}

async function resolveAgentPrompt(agent: AgentDefinition): Promise<string> {
  if (typeof agent.prompt === "string") {
    return agent.prompt;
  }
  return await readFile(agent.prompt.file, "utf-8");
}

export function composeSystemPrompt(
  persona: string,
  promptBody: string,
): string {
  return [persona.trim(), promptBody.trim()]
    .filter((s) => s.length > 0)
    .join("\n\n");
}

export class ClaudeCliAdapter implements BackendAdapter {
  async dispatch(
    prompt: string,
    agent: AgentDefinition,
    opts: { timeoutMs: number },
  ): Promise<AgentResponse> {
    const promptBody = await resolveAgentPrompt(agent);
    const systemPrompt = composeSystemPrompt(agent.persona, promptBody);

    const args = ["--print"];
    if (systemPrompt.length > 0) {
      args.push("--system-prompt", systemPrompt);
    }

    const start = performance.now();
    const result = await execa("claude", args, {
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
  }
}
