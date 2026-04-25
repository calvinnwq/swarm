import { SwarmCommandError } from "../lib/parse-command.js";
import {
  getHarnessDescriptor,
  listImplementedHarnessIds,
} from "../lib/harness-registry.js";
import type { ResolvedAgentRuntime } from "../lib/harness-resolution.js";
import type { AgentDefinition } from "../schemas/agent-definition.js";
import type { HarnessId } from "../schemas/harness-id.js";
import { ClaudeCliAdapter } from "./claude-cli.js";
import { CodexCliAdapter } from "./codex-cli.js";
import { OpenCodeCliAdapter } from "./opencode-cli.js";
import type { BackendAdapter } from "./index.js";

export function createHarnessAdapter(harness: HarnessId): BackendAdapter {
  const descriptor = getHarnessDescriptor(harness);
  if (descriptor.status !== "implemented") {
    throw new SwarmCommandError(
      `harness "${harness}" is not yet implemented; available harnesses: ${listImplementedHarnessIds().join(", ")}`,
    );
  }
  switch (harness) {
    case "claude":
      return new ClaudeCliAdapter();
    case "codex":
      return new CodexCliAdapter();
    case "opencode":
      return new OpenCodeCliAdapter();
    default:
      throw new SwarmCommandError(
        `harness "${harness}" has no adapter implementation`,
      );
  }
}

export class HarnessAdapterRegistry {
  private readonly adapters = new Map<HarnessId, BackendAdapter>();

  get(harness: HarnessId): BackendAdapter {
    const cached = this.adapters.get(harness);
    if (cached) return cached;
    const adapter = createHarnessAdapter(harness);
    this.adapters.set(harness, adapter);
    return adapter;
  }

  forRuntime(runtime: ResolvedAgentRuntime): BackendAdapter {
    return this.get(runtime.harness);
  }

  has(harness: HarnessId): boolean {
    return this.adapters.has(harness);
  }

  size(): number {
    return this.adapters.size;
  }

  harnesses(): readonly HarnessId[] {
    return [...this.adapters.keys()];
  }
}

export function buildHarnessAdapterRegistry(
  resolved: readonly ResolvedAgentRuntime[],
): HarnessAdapterRegistry {
  const registry = new HarnessAdapterRegistry();
  for (const entry of resolved) {
    registry.get(entry.harness);
  }
  return registry;
}

/**
 * Builds a per-agent adapter resolver from a list of resolved runtimes and a
 * pre-warmed registry. The returned resolver dispatches each AgentDefinition
 * to the adapter for its resolved harness; agents not in `resolved` raise a
 * SwarmCommandError so dispatch never silently picks a default backend.
 */
export function createAgentAdapterResolver(
  resolved: readonly ResolvedAgentRuntime[],
  registry: HarnessAdapterRegistry,
): (agent: AgentDefinition) => BackendAdapter {
  const harnessByAgent = new Map<string, HarnessId>();
  for (const entry of resolved) {
    harnessByAgent.set(entry.agentName, entry.harness);
  }
  return (agent) => {
    const harness = harnessByAgent.get(agent.name);
    if (harness === undefined) {
      throw new SwarmCommandError(
        `agent "${agent.name}" has no resolved runtime; resolve runtimes before dispatching`,
      );
    }
    return registry.get(harness);
  };
}

/**
 * Builds a per-agent runtime resolver from a list of resolved runtimes. The
 * returned resolver hands each AgentDefinition its ResolvedAgentRuntime so
 * round-runner can stamp the resolved harness/model onto the AgentResult for
 * artifact writers. Returns undefined for agents not present in `resolved`.
 */
export function createAgentRuntimeResolver(
  resolved: readonly ResolvedAgentRuntime[],
): (agent: AgentDefinition) => ResolvedAgentRuntime | undefined {
  const runtimeByAgent = new Map<string, ResolvedAgentRuntime>();
  for (const entry of resolved) {
    runtimeByAgent.set(entry.agentName, entry);
  }
  return (agent) => runtimeByAgent.get(agent.name);
}
