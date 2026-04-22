import type { AgentDefinition } from "../schemas/agent-definition.js";
import type { BackendId } from "../schemas/backend-id.js";
import { SwarmCommandError } from "./parse-command.js";

interface AgentBackendMismatch {
  agentName: string;
  agentBackend: string;
}

export function collectAgentBackendMismatches(
  backend: BackendId,
  agents: AgentDefinition[],
): AgentBackendMismatch[] {
  return agents
    .filter((agent) => agent.backend !== backend)
    .map((agent) => ({
      agentName: agent.name,
      agentBackend: agent.backend,
    }));
}

export function assertAgentBackendsMatch(
  backend: BackendId,
  agents: AgentDefinition[],
): void {
  const mismatches = collectAgentBackendMismatches(backend, agents);
  if (mismatches.length === 0) {
    return;
  }

  const detail = mismatches
    .map((mismatch) => `${mismatch.agentName} (${mismatch.agentBackend})`)
    .join(", ");
  throw new SwarmCommandError(
    `selected backend "${backend}" does not match agent backend(s): ${detail}`,
  );
}
