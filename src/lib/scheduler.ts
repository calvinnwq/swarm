import type { AgentDefinition, RoundPacket } from "../schemas/index.js";

export type SchedulerPolicy = "all" | "addressed-only";

export interface SchedulerDecision {
  round: number;
  policy: SchedulerPolicy;
  selected: string[];
  reason: string;
}

/**
 * Determines which agents should run in the given round based on the policy.
 *
 * "all": every agent runs every round (default, current behavior).
 * "addressed-only": in round 2+, only agents that succeeded in the prior round
 * are woken; if none succeeded, falls back to all agents. Round 1 always wakes
 * all agents regardless of policy.
 */
export function selectAgentsForRound(
  agents: AgentDefinition[],
  round: number,
  priorPacket: RoundPacket | null,
  policy: SchedulerPolicy,
): SchedulerDecision {
  const all = agents.map((a) => a.name);

  if (policy === "all" || round === 1 || priorPacket === null) {
    return {
      round,
      policy,
      selected: all,
      reason:
        round === 1
          ? "all agents wake on round 1"
          : "policy=all: all agents wake every round",
    };
  }

  const priorSucceeded = new Set(priorPacket.summaries.map((s) => s.agent));
  const selected = agents
    .filter((a) => priorSucceeded.has(a.name))
    .map((a) => a.name);

  if (selected.length === 0) {
    return {
      round,
      policy,
      selected: all,
      reason: `policy=addressed-only: no prior successes in round ${round - 1}, falling back to all agents`,
    };
  }

  return {
    round,
    policy,
    selected,
    reason: `policy=addressed-only: ${selected.length} agent(s) succeeded in round ${round - 1}`,
  };
}
