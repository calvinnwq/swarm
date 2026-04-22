import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../../../src/schemas/agent-definition.js";
import { SwarmCommandError } from "../../../src/lib/parse-command.js";

describe("assertAgentBackendsMatch", () => {
  it("accepts matching agent backends", async () => {
    const lib = await import("../../../src/lib/index.js");
    const agents: AgentDefinition[] = [
      {
        name: "alpha",
        description: "alpha",
        persona: "alpha",
        prompt: "alpha",
        backend: "claude",
      },
      {
        name: "beta",
        description: "beta",
        persona: "beta",
        prompt: "beta",
        backend: "claude",
      },
    ];

    expect(typeof lib.assertAgentBackendsMatch).toBe("function");
    expect(() =>
      lib.assertAgentBackendsMatch?.("claude", agents),
    ).not.toThrow();
  });

  it("fails fast when an agent backend disagrees with the selected runtime backend", async () => {
    const lib = await import("../../../src/lib/index.js");
    const agents = [
      {
        name: "alpha",
        description: "alpha",
        persona: "alpha",
        prompt: "alpha",
        backend: "claude",
      },
      {
        name: "beta",
        description: "beta",
        persona: "beta",
        prompt: "beta",
        backend: "openai",
      },
    ] as AgentDefinition[];

    expect(() => lib.assertAgentBackendsMatch?.("claude", agents)).toThrow(
      SwarmCommandError,
    );
    expect(() => lib.assertAgentBackendsMatch?.("claude", agents)).toThrow(
      /beta/,
    );
  });
});
