import { existsSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import {
  CodexCliAdapter,
  composeCodexPrompt,
  normalizeCodexStderr,
} from "../../../src/backends/codex-cli.js";
import type { AgentDefinition } from "../../../src/schemas/index.js";

describe("composeCodexPrompt", () => {
  it("embeds persona, prompt body, and the swarm brief into one prompt", () => {
    const prompt = composeCodexPrompt(
      "You are a rigorous product manager.",
      "Return only the swarm JSON contract.",
      "Topic: Should we adopt Codex?",
    );

    expect(prompt).toContain("You are a rigorous product manager.");
    expect(prompt).toContain("Return only the swarm JSON contract.");
    expect(prompt).toContain("Topic: Should we adopt Codex?");
    expect(prompt).toContain(
      "Do not inspect files, run commands, or use tools",
    );
  });
});

describe("normalizeCodexStderr", () => {
  it("removes Codex CLI banner noise and keeps the actionable failure detail", () => {
    const stderr = [
      "OpenAI Codex v0.122.0 (research preview)",
      "--------",
      "workdir: /tmp/project",
      "approval: never",
      "sandbox: read-only",
      "user",
      "Return JSON",
      "2026-04-22T13:47:36.176334Z  WARN codex_core_plugins::manifest: noisy",
      "Error: model overloaded",
      "tokens used",
    ].join("\n");

    expect(normalizeCodexStderr(stderr)).toBe(
      ["Return JSON", "Error: model overloaded"].join("\n"),
    );
  });
});

describe("CodexCliAdapter", () => {
  const agent: AgentDefinition = {
    name: "product-manager-codex",
    description: "Product-focused Codex agent",
    persona: "You are a rigorous product manager.",
    prompt: "Return only the swarm JSON contract.",
    backend: "codex",
  };

  beforeEach(() => {
    vi.mocked(execa).mockReset();
  });

  it("dispatches through codex exec with the expected non-interactive flags", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout:
        '{"agent":"product-manager-codex","round":1,"stance":"Adopt","recommendation":"Use Codex","reasoning":[],"objections":[],"risks":[],"changesFromPriorRound":[],"confidence":"high","openQuestions":[]}',
      stderr: "",
      timedOut: false,
    } as Awaited<ReturnType<typeof execa>>);

    const adapter = new CodexCliAdapter();
    await adapter.dispatch("Topic: Should we adopt Codex?", agent, {
      timeoutMs: 5_000,
    });

    expect(vi.mocked(execa)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(execa).mock.calls[0] as unknown[] | undefined;
    expect(call).toBeDefined();
    const command = call?.[0];
    const args = call?.[1];
    const options = call?.[2];

    expect(command).toBe("codex");
    expect(args).toEqual(
      expect.arrayContaining([
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "-C",
        "-c",
        'reasoning_effort="none"',
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--output-schema",
      ]),
    );

    const outputSchemaFlag = (args as string[]).indexOf("--output-schema");
    const outputSchemaPath = (args as string[])[outputSchemaFlag + 1];
    const cwdFlag = (args as string[]).indexOf("-C");
    const codexWorkdir = (args as string[])[cwdFlag + 1];
    expect(cwdFlag).toBeGreaterThan(-1);
    expect(codexWorkdir).toBeTruthy();
    expect(existsSync(codexWorkdir)).toBe(true);
    expect(outputSchemaFlag).toBeGreaterThan(-1);
    expect(outputSchemaPath).toBeTruthy();
    expect(existsSync(outputSchemaPath)).toBe(true);
    expect((args as string[]).at(-1)).toContain(
      "Topic: Should we adopt Codex?",
    );
    expect((args as string[]).at(-1)).toContain(agent.persona);
    expect((args as string[]).at(-1)).toContain(
      "Return only the swarm JSON contract.",
    );
    expect(options).toMatchObject({
      reject: false,
      stdin: "ignore",
      timeout: 5_000,
    });
    expect(args).not.toContain("-m");
  });

  it("creates an isolated workdir for each dispatch", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          '{"agent":"product-manager-codex","round":1,"stance":"Adopt","recommendation":"Use Codex","reasoning":[],"objections":[],"risks":[],"changesFromPriorRound":[],"confidence":"high","openQuestions":[]}',
        stderr: "",
        timedOut: false,
      } as Awaited<ReturnType<typeof execa>>)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          '{"agent":"product-manager-codex","round":1,"stance":"Adopt","recommendation":"Use Codex","reasoning":[],"objections":[],"risks":[],"changesFromPriorRound":[],"confidence":"high","openQuestions":[]}',
        stderr: "",
        timedOut: false,
      } as Awaited<ReturnType<typeof execa>>);

    const adapter = new CodexCliAdapter();
    await adapter.dispatch("Topic: First run", agent, { timeoutMs: 5_000 });
    await adapter.dispatch("Topic: Second run", agent, { timeoutMs: 5_000 });

    const firstArgs = vi.mocked(execa).mock.calls[0]?.[1] as string[];
    const secondArgs = vi.mocked(execa).mock.calls[1]?.[1] as string[];
    const firstWorkdir = firstArgs[firstArgs.indexOf("-C") + 1];
    const secondWorkdir = secondArgs[secondArgs.indexOf("-C") + 1];

    expect(firstWorkdir).toBeTruthy();
    expect(secondWorkdir).toBeTruthy();
    expect(firstWorkdir).not.toBe(secondWorkdir);
  });

  it("formats failure output using normalized stderr", () => {
    const adapter = new CodexCliAdapter();
    const formatted = adapter.formatFailure({
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: [
        "OpenAI Codex v0.122.0 (research preview)",
        "approval: never",
        "Error: model overloaded",
      ].join("\n"),
      timedOut: false,
      durationMs: 123,
    });

    expect(formatted).toContain("Agent exited with code 1");
    expect(formatted).toContain("Error: model overloaded");
    expect(formatted).not.toContain("approval: never");
  });
});
