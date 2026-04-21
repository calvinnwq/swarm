import { describe, expect, it } from "vitest";
import { SwarmPresetSchema } from "../../../src/schemas/index.js";

describe("SwarmPresetSchema", () => {
  it("accepts a minimal preset with name and agents", () => {
    const parsed = SwarmPresetSchema.parse({
      name: "product-decision",
      agents: ["product-manager", "principal-engineer"],
    });
    expect(parsed.name).toBe("product-decision");
    expect(parsed.agents).toEqual(["product-manager", "principal-engineer"]);
  });

  it("accepts a full preset with all optional fields", () => {
    const parsed = SwarmPresetSchema.parse({
      name: "full",
      description: "Full preset",
      agents: ["a", "b", "c"],
      resolve: "orchestrator",
      goal: "ship",
      decision: "pick one",
    });
    expect(parsed.resolve).toBe("orchestrator");
    expect(parsed.goal).toBe("ship");
  });

  it("rejects fewer than 2 agents", () => {
    expect(() =>
      SwarmPresetSchema.parse({ name: "x", agents: ["solo"] }),
    ).toThrow();
  });

  it("rejects more than 5 agents", () => {
    expect(() =>
      SwarmPresetSchema.parse({
        name: "x",
        agents: ["a", "b", "c", "d", "e", "f"],
      }),
    ).toThrow();
  });

  it("rejects empty name", () => {
    expect(() =>
      SwarmPresetSchema.parse({ name: "   ", agents: ["a", "b"] }),
    ).toThrow();
  });

  it("rejects rounds because presets do not control it", () => {
    expect(() =>
      SwarmPresetSchema.parse({
        name: "x",
        agents: ["a", "b"],
        rounds: 2,
      }),
    ).toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() =>
      SwarmPresetSchema.parse({
        name: "x",
        agents: ["a", "b"],
        unknown: true,
      }),
    ).toThrow();
  });
});
