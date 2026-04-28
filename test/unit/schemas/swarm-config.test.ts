import { describe, expect, it } from "vitest";
import { SwarmProjectConfigSchema } from "../../../src/schemas/index.js";

describe("SwarmProjectConfigSchema", () => {
  it("accepts an empty object", () => {
    expect(SwarmProjectConfigSchema.parse({})).toEqual({});
  });

  it("accepts a fully populated config", () => {
    const parsed = SwarmProjectConfigSchema.parse({
      rounds: 2,
      preset: "product-decision",
      agents: ["product-manager", "principal-engineer"],
      resolve: "orchestrator",
      timeoutMs: 300_000,
      goal: "ship the slice",
      decision: "adopt / defer / reject",
      docs: ["docs/brief.md"],
    });
    expect(parsed.rounds).toBe(2);
    expect(parsed.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(parsed.resolve).toBe("orchestrator");
    expect(parsed.timeoutMs).toBe(300_000);
  });

  it.each([0, 4, 1.5])("rejects invalid rounds value %s", (value) => {
    expect(SwarmProjectConfigSchema.safeParse({ rounds: value }).success).toBe(
      false,
    );
  });

  it("rejects fewer than 2 agents", () => {
    expect(
      SwarmProjectConfigSchema.safeParse({ agents: ["only-one"] }).success,
    ).toBe(false);
  });

  it("rejects more than 5 agents", () => {
    expect(
      SwarmProjectConfigSchema.safeParse({
        agents: ["a", "b", "c", "d", "e", "f"],
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown resolve mode", () => {
    expect(
      SwarmProjectConfigSchema.safeParse({ resolve: "majority" }).success,
    ).toBe(false);
  });

  it.each([0, -1, 1.5])("rejects invalid timeoutMs value %s", (value) => {
    expect(
      SwarmProjectConfigSchema.safeParse({ timeoutMs: value }).success,
    ).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    expect(SwarmProjectConfigSchema.safeParse({ unknown: "x" }).success).toBe(
      false,
    );
  });

  it("rejects empty preset string", () => {
    expect(SwarmProjectConfigSchema.safeParse({ preset: "   " }).success).toBe(
      false,
    );
  });
});
