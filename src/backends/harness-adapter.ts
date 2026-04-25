import { SwarmCommandError } from "../lib/parse-command.js";
import {
  getHarnessDescriptor,
  listImplementedHarnessIds,
} from "../lib/harness-registry.js";
import type { ResolvedAgentRuntime } from "../lib/harness-resolution.js";
import type { HarnessId } from "../schemas/harness-id.js";
import { ClaudeCliAdapter } from "./claude-cli.js";
import { CodexCliAdapter } from "./codex-cli.js";
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
