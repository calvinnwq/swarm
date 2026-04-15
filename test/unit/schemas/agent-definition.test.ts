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
});
