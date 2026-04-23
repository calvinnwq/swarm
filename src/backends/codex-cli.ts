import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import type { AgentDefinition } from "../schemas/index.js";
import type { AgentResponse, BackendAdapter } from "./index.js";
import { extractAgentOutputJson } from "./json-output.js";
import { joinPromptSections, resolveAgentPrompt } from "./shared.js";

const AGENT_OUTPUT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
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
  ],
  properties: {
    agent: { type: "string", minLength: 1 },
    round: { type: "integer", minimum: 0 },
    stance: { type: "string" },
    recommendation: { type: "string" },
    reasoning: { type: "array", items: { type: "string" } },
    objections: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    changesFromPriorRound: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    openQuestions: { type: "array", items: { type: "string" } },
  },
} as const;

let schemaPathPromise: Promise<string> | null = null;

async function ensureOutputSchemaPath(): Promise<string> {
  if (!schemaPathPromise) {
    schemaPathPromise = (async () => {
      const filePath = join(tmpdir(), "swarm-codex-agent-output.schema.json");
      await writeFile(
        filePath,
        JSON.stringify(AGENT_OUTPUT_JSON_SCHEMA, null, 2) + "\n",
        "utf-8",
      );

      return filePath;
    })().catch((error) => {
      schemaPathPromise = null;
      throw error;
    });
  }

  return await schemaPathPromise;
}

async function ensureCodexWorkdir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "swarm-codex-workdir-"));
}

export function composeCodexPrompt(
  persona: string,
  promptBody: string,
  brief: string,
): string {
  return joinPromptSections(
    persona,
    promptBody,
    "Do not inspect files, run commands, or use tools. Answer using only the information in this prompt and return the JSON object immediately.",
    "Use the following swarm brief to ground your response.",
    brief,
  );
}

export function normalizeCodexStderr(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== "Reading additional input from stdin...")
    .filter((line) => !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(line))
    .filter((line) => line !== "--------")
    .filter(
      (line) =>
        ![
          "OpenAI Codex v",
          "workdir:",
          "model:",
          "provider:",
          "approval:",
          "sandbox:",
          "reasoning effort:",
          "reasoning summaries:",
          "session id:",
          "user",
          "tokens used",
          "exec",
        ].some((prefix) => line.startsWith(prefix)),
    );

  if (lines.length === 0) {
    return stderr.trim();
  }

  return lines.join("\n");
}

export class CodexCliAdapter implements BackendAdapter {
  readonly wrapperName = "codex-cli";

  extractOutputJson(raw: string): unknown {
    return extractAgentOutputJson(raw);
  }

  formatFailure(response: AgentResponse): string {
    if (response.timedOut) {
      return `Agent timed out after ${response.durationMs}ms`;
    }

    const detail =
      normalizeCodexStderr(response.stderr) ||
      response.stdout.trim() ||
      "codex exec failed without stderr output";
    return `Agent exited with code ${response.exitCode}: ${detail}`;
  }

  async dispatch(
    brief: string,
    agent: AgentDefinition,
    opts: { timeoutMs: number },
  ): Promise<AgentResponse> {
    const promptBody = await resolveAgentPrompt(agent);
    const schemaPath = await ensureOutputSchemaPath();
    const workdir = await ensureCodexWorkdir();
    const prompt = composeCodexPrompt(agent.persona, promptBody, brief);

    const start = performance.now();
    try {
      const result = await execa(
        "codex",
        [
          "exec",
          "--ephemeral",
          "--ignore-rules",
          "--skip-git-repo-check",
          "-C",
          workdir,
          "-c",
          'reasoning_effort="none"',
          "--sandbox",
          "read-only",
          "--color",
          "never",
          "--output-schema",
          schemaPath,
          "-",
        ],
        {
          input: prompt,
          timeout: opts.timeoutMs,
          reject: false,
        },
      );
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
