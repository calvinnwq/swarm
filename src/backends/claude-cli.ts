import { readFile } from "node:fs/promises";
import { execa } from "execa";
import { AgentOutputSchema } from "../schemas/index.js";
import type { AgentDefinition, AgentOutput } from "../schemas/index.js";
import type { AgentResponse, BackendAdapter } from "./index.js";

const PartialAgentOutputSchema = AgentOutputSchema.partial();
const agentOutputKeys = [
  "agent",
  "round",
  "stance",
  "recommendation",
  "reasoning",
  "objections",
  "risks",
  "changesFromPriorRound",
  "confidence",
  "openQuestions",
] as const;

function isAgentOutputLike(candidate: unknown): boolean {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Array.isArray(candidate) ||
    !PartialAgentOutputSchema.safeParse(candidate).success
  ) {
    return false;
  }

  return agentOutputKeys.some((key) => key in candidate);
}

/**
 * Extract JSON from Claude CLI output that may contain markdown fences,
 * leading prose, or trailing junk. Mirrors the reference Python
 * `parse_agent_output` behavior.
 */
export function extractJson(raw: string): unknown {
  return extractJsonCandidates(raw)[0];
}

function extractJsonCandidates(raw: string): unknown[] {
  const trimmed = raw.trim();
  const candidates: Array<{ start: number; value: unknown }> = [];

  // 1. Try parsing the whole string as JSON first.
  try {
    candidates.push({ start: 0, value: JSON.parse(trimmed) });
  } catch {
    // fall through
  }

  // 2. Look for fenced JSON blocks: ```json ... ``` or ``` ... ```
  const fenceRe = /```(?:json)?\s*\n([\s\S]*?)```/;
  const fenceMatch = fenceRe.exec(trimmed);
  if (fenceMatch) {
    try {
      candidates.push({ start: fenceMatch.index, value: JSON.parse(fenceMatch[1].trim()) });
    } catch {
      // fall through
    }
  }

  // 3. Scan for a balanced JSON object, tolerating prose that may contain
  // non-JSON braces before or after the actual payload.
  for (let start = trimmed.indexOf("{"); start !== -1; start = trimmed.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < trimmed.length; i += 1) {
      const char = trimmed[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth += 1;
        continue;
      }

      if (char !== "}") {
        continue;
      }

      depth -= 1;
      if (depth !== 0) {
        continue;
      }

      try {
        candidates.push({ start, value: JSON.parse(trimmed.slice(start, i + 1)) });
        break;
      } catch {
        break;
      }
    }
  }

  return candidates
    .sort((left, right) => left.start - right.start)
    .map((candidate) => candidate.value);
}

export function extractAgentOutputJson(raw: string): unknown {
  const candidates = extractJsonCandidates(raw);
  if (candidates.length === 0) {
    return undefined;
  }

  for (const candidate of candidates) {
    if (AgentOutputSchema.safeParse(candidate).success) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (isAgentOutputLike(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

/**
 * Parse raw CLI output into a validated AgentOutput.
 * Throws a descriptive error when extraction or validation fails.
 */
export function parseAgentOutput(raw: string): AgentOutput {
  const json = extractAgentOutputJson(raw);
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
