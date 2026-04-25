import { describe, expect, it } from "vitest";
import { AgentDefinitionSchema } from "../../../src/schemas/index.js";

describe("AgentDefinitionSchema", () => {
  it("accepts a minimal inline-prompt definition and defaults backend to claude", () => {
    const parsed = AgentDefinitionSchema.parse({
      name: "alpha",
      description: "A sample agent",
      persona: "You are a sample agent.",
      prompt: "Respond with the swarm JSON contract.",
    });
    expect(parsed.backend).toBe("claude");
  });

  it("accepts a file-reference prompt", () => {
    const parsed = AgentDefinitionSchema.parse({
      name: "beta",
      description: "A sample agent",
      persona: "You are a sample agent.",
      prompt: { file: "prompts/beta.md" },
    });
    expect(parsed.prompt).toEqual({ file: "prompts/beta.md" });
  });

  it("accepts codex as a supported backend", () => {
    const parsed = AgentDefinitionSchema.parse({
      name: "gamma",
      description: "A sample codex agent",
      persona: "You are a sample Codex agent.",
      prompt: "Respond with the swarm JSON contract.",
      backend: "codex",
    });

    expect(parsed.backend).toBe("codex");
  });

  it("rejects an invalid agent name", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "Bad Name!",
      description: "x",
      persona: "x",
      prompt: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported backend", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "x",
      description: "x",
      persona: "x",
      prompt: "x",
      backend: "openai",
    });
    expect(result.success).toBe(false);
  });

  it("leaves harness and model undefined when not provided", () => {
    const parsed = AgentDefinitionSchema.parse({
      name: "delta",
      description: "x",
      persona: "x",
      prompt: "x",
    });

    expect(parsed.harness).toBeUndefined();
    expect(parsed.model).toBeUndefined();
  });

  it("accepts a harness and model on top of backend", () => {
    const parsed = AgentDefinitionSchema.parse({
      name: "epsilon",
      description: "x",
      persona: "x",
      prompt: "x",
      backend: "claude",
      harness: "opencode",
      model: "anthropic/claude-sonnet-4-6",
    });

    expect(parsed.harness).toBe("opencode");
    expect(parsed.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("accepts each known harness id", () => {
    for (const harness of ["claude", "codex", "opencode", "rovo"] as const) {
      const parsed = AgentDefinitionSchema.parse({
        name: `agent-${harness}`,
        description: "x",
        persona: "x",
        prompt: "x",
        harness,
      });
      expect(parsed.harness).toBe(harness);
    }
  });

  it("rejects an unknown harness id", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "zeta",
      description: "x",
      persona: "x",
      prompt: "x",
      harness: "gemini",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty model string", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "eta",
      description: "x",
      persona: "x",
      prompt: "x",
      model: "   ",
    });
    expect(result.success).toBe(false);
  });
});
