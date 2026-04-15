import { describe, expect, it } from "vitest";
import {
  buildConfig,
  dedupeKeepOrder,
  parseAgentsCsv,
  parseResolveMode,
  parseRounds,
  SwarmCommandError,
} from "../../../src/lib/index.js";

describe("parseRounds", () => {
  it.each([1, 2, 3])("accepts %i", (n) => {
    expect(parseRounds(n)).toBe(n);
    expect(parseRounds(String(n))).toBe(n);
  });

  it.each([0, 4, -1, 1.5])("rejects %s", (n) => {
    expect(() => parseRounds(n)).toThrow(SwarmCommandError);
  });

  it("rejects non-numeric input", () => {
    expect(() => parseRounds("two")).toThrow(SwarmCommandError);
  });
});

describe("parseAgentsCsv", () => {
  it("splits comma list, trims, and lowercases", () => {
    expect(parseAgentsCsv(" Alpha , beta , GAMMA ")).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("drops empty entries", () => {
    expect(parseAgentsCsv("alpha,,beta,")).toEqual(["alpha", "beta"]);
  });
});

describe("parseResolveMode", () => {
  it.each([
    ["off", "off"],
    ["none", "off"],
    ["false", "off"],
    ["0", "off"],
    ["on", "orchestrator"],
    ["yes", "orchestrator"],
    ["true", "orchestrator"],
    ["orchestrator", "orchestrator"],
    ["agents", "agents"],
    ["agent", "agents"],
  ])("maps %s -> %s", (input, expected) => {
    expect(parseResolveMode(input)).toBe(expected);
  });

  it("rejects unknown value", () => {
    expect(() => parseResolveMode("majority")).toThrow(SwarmCommandError);
  });
});

describe("dedupeKeepOrder", () => {
  it("preserves first occurrence", () => {
    expect(dedupeKeepOrder(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });
});

describe("buildConfig", () => {
  const baseInput = {
    rounds: 2,
    topic: ["sample", "topic"],
    agents: "alpha,beta",
  };

  it("builds a fully populated config from rich input", () => {
    const config = buildConfig({
      ...baseInput,
      resolve: "orchestrator",
      goal: " ship the slice ",
      decision: " pick option B ",
      docs: ["/tmp/a.md", "/tmp/b.md", "/tmp/a.md"],
      preset: "default",
      commandText: "run 2 sample topic --agents alpha,beta",
    });
    expect(config).toMatchObject({
      topic: "sample topic",
      rounds: 2,
      agents: ["alpha", "beta"],
      selectionSource: "explicit-agents",
      resolveMode: "orchestrator",
      goal: "ship the slice",
      decision: "pick option B",
      docs: ["/tmp/a.md", "/tmp/b.md"],
      preset: "default",
    });
  });

  it("defaults resolveMode to off and nulls optional fields", () => {
    const config = buildConfig(baseInput);
    expect(config.resolveMode).toBe("off");
    expect(config.goal).toBeNull();
    expect(config.decision).toBeNull();
    expect(config.preset).toBeNull();
    expect(config.docs).toEqual([]);
  });

  it("rejects empty topic", () => {
    expect(() =>
      buildConfig({ ...baseInput, topic: ["   "] }),
    ).toThrow(SwarmCommandError);
  });

  it("rejects fewer than 2 agents", () => {
    expect(() =>
      buildConfig({ ...baseInput, agents: "alpha" }),
    ).toThrow(SwarmCommandError);
  });

  it("rejects more than 5 agents", () => {
    expect(() =>
      buildConfig({ ...baseInput, agents: "a,b,c,d,e,f" }),
    ).toThrow(SwarmCommandError);
  });

  it("rejects when --agents is omitted (preset registry deferred)", () => {
    expect(() =>
      buildConfig({ rounds: 1, topic: ["t"] }),
    ).toThrow(SwarmCommandError);
  });

  it("dedupes agents preserving order", () => {
    const config = buildConfig({
      ...baseInput,
      agents: "alpha,beta,alpha",
    });
    expect(config.agents).toEqual(["alpha", "beta"]);
  });
});
