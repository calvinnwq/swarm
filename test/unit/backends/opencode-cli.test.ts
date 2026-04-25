import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import {
  OpenCodeCliAdapter,
  composeOpenCodePrompt,
  normalizeOpenCodeStderr,
} from "../../../src/backends/opencode-cli.js";
import type { AgentDefinition } from "../../../src/schemas/index.js";

describe("composeOpenCodePrompt", () => {
  it("embeds persona, prompt body, and the swarm brief into one prompt", () => {
    const prompt = composeOpenCodePrompt(
      "You are a rigorous staff engineer.",
      "Return only the swarm JSON contract.",
      "Topic: Should we adopt OpenCode?",
    );

    expect(prompt).toContain("You are a rigorous staff engineer.");
    expect(prompt).toContain("Return only the swarm JSON contract.");
    expect(prompt).toContain("Topic: Should we adopt OpenCode?");
    expect(prompt).toContain("Do not modify files, run commands, or use tools");
  });
});

describe("normalizeOpenCodeStderr", () => {
  it("strips opencode banner noise and keeps actionable failure detail", () => {
    const stderr = [
      "opencode v0.42.0",
      "session: 1234abcd",
      "model: anthropic/claude-sonnet-4-7",
      "agent: build",
      "mode: build",
      "provider: anthropic",
      "Error: provider rate limited",
      "tokens used: 1234",
    ].join("\n");

    expect(normalizeOpenCodeStderr(stderr)).toBe(
      "Error: provider rate limited",
    );
  });

  it("returns the trimmed stderr when nothing actionable remains", () => {
    expect(normalizeOpenCodeStderr("opencode v0.42.0\n")).toBe(
      "opencode v0.42.0",
    );
  });
});

describe("OpenCodeCliAdapter", () => {
  const agent: AgentDefinition = {
    name: "staff-engineer-opencode",
    description: "Engineering-focused OpenCode agent",
    persona: "You are a rigorous staff engineer.",
    prompt: "Return only the swarm JSON contract.",
    backend: "claude",
    harness: "opencode",
  };

  beforeEach(() => {
    vi.mocked(execa).mockReset();
  });

  it("dispatches through opencode run with the prompt as a positional argument", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout:
        '{"agent":"staff-engineer-opencode","round":1,"stance":"Adopt","recommendation":"Use OpenCode","reasoning":[],"objections":[],"risks":[],"changesFromPriorRound":[],"confidence":"high","openQuestions":[]}',
      stderr: "",
      timedOut: false,
    } as Awaited<ReturnType<typeof execa>>);

    const adapter = new OpenCodeCliAdapter();
    await adapter.dispatch("Topic: Should we adopt OpenCode?", agent, {
      timeoutMs: 5_000,
    });

    expect(vi.mocked(execa)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(execa).mock.calls[0] as unknown[] | undefined;
    expect(call).toBeDefined();
    const command = call?.[0];
    const args = call?.[1] as string[];
    const options = call?.[2];

    expect(command).toBe("opencode");
    expect(args[0]).toBe("run");
    expect(args).not.toContain("--model");
    const positional = args.at(-1)!;
    expect(positional).toContain(agent.persona);
    expect(positional).toContain("Return only the swarm JSON contract.");
    expect(positional).toContain("Topic: Should we adopt OpenCode?");
    expect(options).toMatchObject({
      reject: false,
      timeout: 5_000,
    });
  });

  it("forwards agent.model as --model when set", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout:
        '{"agent":"staff-engineer-opencode","round":1,"stance":"Adopt","recommendation":"x","reasoning":[],"objections":[],"risks":[],"changesFromPriorRound":[],"confidence":"high","openQuestions":[]}',
      stderr: "",
      timedOut: false,
    } as Awaited<ReturnType<typeof execa>>);

    const adapter = new OpenCodeCliAdapter();
    await adapter.dispatch(
      "brief",
      { ...agent, model: "anthropic/sonnet-4-7" },
      {
        timeoutMs: 5_000,
      },
    );

    const args = vi.mocked(execa).mock.calls[0]?.[1] as string[];
    const flagIndex = args.indexOf("--model");
    expect(flagIndex).toBeGreaterThan(-1);
    expect(args[flagIndex + 1]).toBe("anthropic/sonnet-4-7");
  });

  it("formats failure output using normalized stderr", () => {
    const adapter = new OpenCodeCliAdapter();
    const formatted = adapter.formatFailure({
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: [
        "opencode v0.42.0",
        "session: abc",
        "Error: model overloaded",
      ].join("\n"),
      timedOut: false,
      durationMs: 250,
    });

    expect(formatted).toContain("Agent exited with code 1");
    expect(formatted).toContain("Error: model overloaded");
    expect(formatted).not.toContain("session: abc");
  });

  it("formats timeout failures with the duration", () => {
    const adapter = new OpenCodeCliAdapter();
    const formatted = adapter.formatFailure({
      ok: false,
      exitCode: 124,
      stdout: "",
      stderr: "",
      timedOut: true,
      durationMs: 9_999,
    });
    expect(formatted).toBe("Agent timed out after 9999ms");
  });

  it("extracts JSON from raw output via the shared extractor", () => {
    const adapter = new OpenCodeCliAdapter();
    const raw = `Here you go:\n{"agent":"a","round":1,"stance":"s","recommendation":"r","reasoning":[],"objections":[],"risks":[],"changesFromPriorRound":[],"confidence":"low","openQuestions":[]}`;
    const json = adapter.extractOutputJson(raw) as { agent: string };
    expect(json.agent).toBe("a");
  });
});
