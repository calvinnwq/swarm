import { describe, expect, it } from "vitest";
import {
  buildHarnessAdapterRegistry,
  createAgentAdapterResolver,
  createAgentRuntimeResolver,
  createHarnessAdapter,
  HarnessAdapterRegistry,
} from "../../../src/backends/harness-adapter.js";
import { ClaudeCliAdapter } from "../../../src/backends/claude-cli.js";
import { CodexCliAdapter } from "../../../src/backends/codex-cli.js";
import { resolveAgentRuntime } from "../../../src/lib/harness-resolution.js";
import { SwarmCommandError } from "../../../src/lib/parse-command.js";
import {
  AgentDefinitionSchema,
  type AgentDefinition,
} from "../../../src/schemas/agent-definition.js";

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return AgentDefinitionSchema.parse({
    name: "agent-x",
    description: "a test agent",
    persona: "test persona",
    prompt: "do the thing",
    ...overrides,
  });
}

describe("createHarnessAdapter", () => {
  it("creates a Claude adapter for the claude harness", () => {
    expect(createHarnessAdapter("claude")).toBeInstanceOf(ClaudeCliAdapter);
  });

  it("creates a Codex adapter for the codex harness", () => {
    expect(createHarnessAdapter("codex")).toBeInstanceOf(CodexCliAdapter);
  });

  it("rejects planned harnesses with a hard-fail", () => {
    expect(() => createHarnessAdapter("opencode")).toThrow(SwarmCommandError);
    expect(() => createHarnessAdapter("rovo")).toThrow(SwarmCommandError);
  });

  it("rejects unknown harness ids", () => {
    expect(() => createHarnessAdapter("nonsense" as never)).toThrow(
      SwarmCommandError,
    );
  });
});

describe("HarnessAdapterRegistry", () => {
  it("caches adapters per harness id", () => {
    const registry = new HarnessAdapterRegistry();
    const a = registry.get("claude");
    const b = registry.get("claude");
    expect(a).toBe(b);
    expect(registry.size()).toBe(1);
    expect(registry.has("claude")).toBe(true);
    expect(registry.has("codex")).toBe(false);
  });

  it("lazily instantiates additional harnesses on demand", () => {
    const registry = new HarnessAdapterRegistry();
    expect(registry.size()).toBe(0);
    registry.get("claude");
    registry.get("codex");
    expect(registry.size()).toBe(2);
    expect(registry.harnesses()).toEqual(
      expect.arrayContaining(["claude", "codex"]),
    );
  });

  it("returns the cached adapter via forRuntime", () => {
    const registry = new HarnessAdapterRegistry();
    const runtime = resolveAgentRuntime(
      makeAgent({ backend: "codex", harness: "codex" }),
    );
    const adapter = registry.forRuntime(runtime);
    expect(adapter).toBeInstanceOf(CodexCliAdapter);
    expect(registry.forRuntime(runtime)).toBe(adapter);
  });

  it("hard-fails forRuntime when the harness is not implemented", () => {
    const registry = new HarnessAdapterRegistry();
    const runtime = resolveAgentRuntime(
      makeAgent({ backend: "claude", harness: "opencode" }),
    );
    expect(() => registry.forRuntime(runtime)).toThrow(SwarmCommandError);
  });
});

describe("buildHarnessAdapterRegistry", () => {
  it("pre-creates adapters for every distinct harness in the resolved set", () => {
    const resolved = [
      resolveAgentRuntime(
        makeAgent({ name: "a", backend: "claude", harness: "claude" }),
      ),
      resolveAgentRuntime(
        makeAgent({ name: "b", backend: "codex", harness: "codex" }),
      ),
      resolveAgentRuntime(
        makeAgent({ name: "c", backend: "claude", harness: "claude" }),
      ),
    ];
    const registry = buildHarnessAdapterRegistry(resolved);
    expect(registry.size()).toBe(2);
    expect(registry.has("claude")).toBe(true);
    expect(registry.has("codex")).toBe(true);
  });

  it("propagates the hard-fail when a planned harness is requested", () => {
    const resolved = [
      resolveAgentRuntime(
        makeAgent({ name: "ok", backend: "claude", harness: "claude" }),
      ),
      resolveAgentRuntime(
        makeAgent({ name: "planned", backend: "claude", harness: "rovo" }),
      ),
    ];
    expect(() => buildHarnessAdapterRegistry(resolved)).toThrow(
      SwarmCommandError,
    );
  });
});

describe("createAgentAdapterResolver", () => {
  it("returns the harness-specific adapter per agent", () => {
    const claudeAgent = makeAgent({
      name: "alpha",
      backend: "claude",
      harness: "claude",
    });
    const codexAgent = makeAgent({
      name: "beta",
      backend: "codex",
      harness: "codex",
    });
    const resolved = [claudeAgent, codexAgent].map(resolveAgentRuntime);
    const registry = buildHarnessAdapterRegistry(resolved);
    const resolve = createAgentAdapterResolver(resolved, registry);

    expect(resolve(claudeAgent)).toBeInstanceOf(ClaudeCliAdapter);
    expect(resolve(codexAgent)).toBeInstanceOf(CodexCliAdapter);
  });

  it("returns the same adapter instance across calls for the same agent", () => {
    const agent = makeAgent({
      name: "alpha",
      backend: "claude",
      harness: "claude",
    });
    const resolved = [agent].map(resolveAgentRuntime);
    const registry = buildHarnessAdapterRegistry(resolved);
    const resolve = createAgentAdapterResolver(resolved, registry);
    expect(resolve(agent)).toBe(resolve(agent));
  });

  it("hard-fails for an agent with no resolved runtime", () => {
    const known = makeAgent({
      name: "alpha",
      backend: "claude",
      harness: "claude",
    });
    const unknown = makeAgent({ name: "ghost" });
    const resolved = [known].map(resolveAgentRuntime);
    const registry = buildHarnessAdapterRegistry(resolved);
    const resolve = createAgentAdapterResolver(resolved, registry);
    expect(() => resolve(unknown)).toThrow(SwarmCommandError);
  });
});

describe("createAgentRuntimeResolver", () => {
  it("returns the resolved runtime for each agent in the resolved list", () => {
    const claudeAgent = makeAgent({
      name: "alpha",
      backend: "claude",
      harness: "claude",
      model: "sonnet-4-7",
    });
    const codexAgent = makeAgent({
      name: "beta",
      backend: "codex",
      harness: "codex",
    });
    const resolved = [claudeAgent, codexAgent].map(resolveAgentRuntime);
    const resolve = createAgentRuntimeResolver(resolved);

    expect(resolve(claudeAgent)).toEqual(
      expect.objectContaining({
        agentName: "alpha",
        harness: "claude",
        model: "sonnet-4-7",
        source: { harness: "agent.harness", model: "agent.model" },
      }),
    );
    expect(resolve(codexAgent)).toEqual(
      expect.objectContaining({
        agentName: "beta",
        harness: "codex",
        model: null,
        source: { harness: "agent.harness", model: "harness-default" },
      }),
    );
  });

  it("returns undefined for agents not present in the resolved list", () => {
    const known = makeAgent({ name: "alpha" });
    const unknown = makeAgent({ name: "ghost" });
    const resolved = [known].map(resolveAgentRuntime);
    const resolve = createAgentRuntimeResolver(resolved);

    expect(resolve(known)).toBeDefined();
    expect(resolve(unknown)).toBeUndefined();
  });

  it("returns identical runtime objects on repeated lookups", () => {
    const agent = makeAgent({ name: "alpha" });
    const resolved = [agent].map(resolveAgentRuntime);
    const resolve = createAgentRuntimeResolver(resolved);
    expect(resolve(agent)).toBe(resolve(agent));
  });
});
