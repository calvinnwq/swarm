import { execa } from "execa";
import { AgentOutputSchema } from "../schemas/index.js";
import type { AgentDefinition, AgentOutput } from "../schemas/index.js";
import type { AgentResponse, BackendAdapter } from "./index.js";
import {
  extractAgentOutputJson as extractAgentOutputJsonFromRaw,
  extractJson as extractJsonFromRaw,
} from "./json-output.js";
import { joinPromptSections, resolveAgentPrompt } from "./shared.js";

/**
 * Extract JSON from Claude CLI output that may contain markdown fences,
 * leading prose, or trailing junk. Mirrors the reference Python
 * `parse_agent_output` behavior.
 */
export function extractJson(raw: string): unknown {
  return extractJsonFromRaw(raw);
}

export function extractAgentOutputJson(raw: string): unknown {
  return extractAgentOutputJsonFromRaw(raw);
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

export function composeSystemPrompt(
  persona: string,
  promptBody: string,
): string {
  return joinPromptSections(persona, promptBody);
}

export class ClaudeCliAdapter implements BackendAdapter {
  readonly wrapperName = "claude-cli";

  extractOutputJson(raw: string): unknown {
    return extractAgentOutputJsonFromRaw(raw);
  }

  formatFailure(response: AgentResponse): string {
    if (response.timedOut) {
      return `Agent timed out after ${response.durationMs}ms`;
    }

    return `Agent exited with code ${response.exitCode}: ${response.stderr}`;
  }

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
