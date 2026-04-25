import { describe, expect, it } from "vitest";
import {
  AgentDefinitionSchema,
  type AgentDefinition,
} from "../../../src/schemas/agent-definition.js";
import {
  assertResolvedRuntimesAvailable,
  backendToHarness,
  collectUnavailableHarnesses,
  resolveAgentRuntime,
  resolveAgentRuntimes,
} from "../../../src/lib/harness-resolution.js";
import { SwarmCommandError } from "../../../src/lib/parse-command.js";

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return AgentDefinitionSchema.parse({
    name: "agent-x",
    description: "a test agent",
    persona: "test persona",
    prompt: "do the thing",
    ...overrides,
  });
}

describe("harness-resolution", () => {
  it("maps backend ids to the matching harness id", () => {
    expect(backendToHarness("claude")).toBe("claude");
    expect(backendToHarness("codex")).toBe("codex");
  });

  it("falls back to backend when harness is not set", () => {
    const agent = makeAgent({ backend: "codex" });
    const resolved = resolveAgentRuntime(agent);
    expect(resolved.harness).toBe("codex");
    expect(resolved.source.harness).toBe("agent.backend");
    expect(resolved.model).toBeNull();
    expect(resolved.source.model).toBe("harness-default");
  });

  it("prefers explicit harness over backend", () => {
    const agent = makeAgent({ backend: "claude", harness: "codex" });
    const resolved = resolveAgentRuntime(agent);
    expect(resolved.harness).toBe("codex");
    expect(resolved.source.harness).toBe("agent.harness");
  });

  it("uses agent.model when provided and tags the source", () => {
    const agent = makeAgent({
      harness: "claude",
      model: "claude-opus-4-7",
    });
    const resolved = resolveAgentRuntime(agent);
    expect(resolved.model).toBe("claude-opus-4-7");
    expect(resolved.source.model).toBe("agent.model");
  });

  it("is deterministic for the same input", () => {
    const agent = makeAgent({ harness: "opencode", model: "gpt-5" });
    const a = resolveAgentRuntime(agent);
    const b = resolveAgentRuntime(agent);
    expect(a).toEqual(b);
  });

  it("resolveAgentRuntimes preserves agent order", () => {
    const agents = [
      makeAgent({ name: "first", harness: "claude" }),
      makeAgent({ name: "second", harness: "codex" }),
      makeAgent({ name: "third", harness: "opencode" }),
    ];
    const resolved = resolveAgentRuntimes(agents);
    expect(resolved.map((r) => r.agentName)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(resolved.map((r) => r.harness)).toEqual([
      "claude",
      "codex",
      "opencode",
    ]);
  });

  it("collectUnavailableHarnesses flags planned harnesses with their agent name", () => {
    const resolved = resolveAgentRuntimes([
      makeAgent({ name: "ok-claude", harness: "claude" }),
      makeAgent({ name: "wants-opencode", harness: "opencode" }),
      makeAgent({ name: "wants-rovo", harness: "rovo" }),
    ]);
    const issues = collectUnavailableHarnesses(resolved);
    expect(issues.map((i) => i.agentName)).toEqual([
      "wants-opencode",
      "wants-rovo",
    ]);
    expect(issues.every((i) => i.reason === "not-implemented")).toBe(true);
    expect(issues[0]?.message).toContain("not yet implemented");
    expect(issues[0]?.message).toContain("claude, codex");
  });

  it("collectUnavailableHarnesses returns an empty list when all harnesses are implemented", () => {
    const resolved = resolveAgentRuntimes([
      makeAgent({ name: "a", harness: "claude" }),
      makeAgent({ name: "b", harness: "codex" }),
    ]);
    expect(collectUnavailableHarnesses(resolved)).toEqual([]);
  });

  it("assertResolvedRuntimesAvailable throws SwarmCommandError when a harness is planned", () => {
    const resolved = resolveAgentRuntimes([
      makeAgent({ name: "wants-opencode", harness: "opencode" }),
    ]);
    expect(() => assertResolvedRuntimesAvailable(resolved)).toThrow(
      SwarmCommandError,
    );
  });

  it("assertResolvedRuntimesAvailable is a no-op when every harness is implemented", () => {
    const resolved = resolveAgentRuntimes([
      makeAgent({ name: "a", harness: "claude" }),
      makeAgent({ name: "b", harness: "codex" }),
    ]);
    expect(() => assertResolvedRuntimesAvailable(resolved)).not.toThrow();
  });
});
