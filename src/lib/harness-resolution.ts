import type { AgentDefinition } from "../schemas/agent-definition.js";
import type { BackendId } from "../schemas/backend-id.js";
import type { HarnessId } from "../schemas/harness-id.js";
import type {
  HarnessResolutionSource,
  ModelResolutionSource,
  ResolvedAgentRuntime,
} from "../schemas/resolved-agent-runtime.js";
import {
  getHarnessDescriptor,
  listImplementedHarnessIds,
} from "./harness-registry.js";
import { SwarmCommandError } from "./parse-command.js";

export type {
  HarnessResolutionSource,
  ModelResolutionSource,
  ResolvedAgentRuntime,
} from "../schemas/resolved-agent-runtime.js";

const BACKEND_TO_HARNESS: Readonly<Record<BackendId, HarnessId>> = {
  claude: "claude",
  codex: "codex",
};

export function backendToHarness(backend: BackendId): HarnessId {
  return BACKEND_TO_HARNESS[backend];
}

export function resolveAgentRuntime(
  agent: AgentDefinition,
): ResolvedAgentRuntime {
  let harness: HarnessId;
  let harnessSource: HarnessResolutionSource;
  if (agent.harness !== undefined) {
    harness = agent.harness;
    harnessSource = "agent.harness";
  } else {
    harness = backendToHarness(agent.backend);
    harnessSource = "agent.backend";
  }

  const model = agent.model ?? null;
  const modelSource: ModelResolutionSource =
    model === null ? "harness-default" : "agent.model";

  return {
    agentName: agent.name,
    harness,
    model,
    source: { harness: harnessSource, model: modelSource },
  };
}

export function resolveAgentRuntimes(
  agents: readonly AgentDefinition[],
): ResolvedAgentRuntime[] {
  return agents.map((agent) => resolveAgentRuntime(agent));
}

export interface HarnessAvailabilityIssue {
  readonly agentName: string;
  readonly harness: HarnessId;
  readonly reason: "not-implemented";
  readonly message: string;
}

export function collectUnavailableHarnesses(
  resolved: readonly ResolvedAgentRuntime[],
): HarnessAvailabilityIssue[] {
  const issues: HarnessAvailabilityIssue[] = [];
  for (const entry of resolved) {
    const descriptor = getHarnessDescriptor(entry.harness);
    if (descriptor.status !== "implemented") {
      issues.push({
        agentName: entry.agentName,
        harness: entry.harness,
        reason: "not-implemented",
        message: `agent "${entry.agentName}" requested harness "${entry.harness}" which is not yet implemented; available harnesses: ${listImplementedHarnessIds().join(", ")}`,
      });
    }
  }
  return issues;
}

export function assertResolvedRuntimesAvailable(
  resolved: readonly ResolvedAgentRuntime[],
): void {
  const issues = collectUnavailableHarnesses(resolved);
  if (issues.length === 0) {
    return;
  }
  const detail = issues.map((issue) => issue.message).join("; ");
  throw new SwarmCommandError(detail);
}
