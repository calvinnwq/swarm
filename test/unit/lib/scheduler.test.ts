import { describe, expect, it } from "vitest";
import {
  selectAgentsForRound,
  type SchedulerPolicy,
} from "../../../src/lib/scheduler.js";
import type {
  AgentDefinition,
  RoundPacket,
} from "../../../src/schemas/index.js";
import { RunEventKindSchema } from "../../../src/schemas/index.js";

const makeAgent = (name: string): AgentDefinition => ({
  name,
  description: name,
  persona: name,
  prompt: name,
  backend: "claude",
});

const makePacket = (successAgents: string[]): RoundPacket => ({
  round: 1,
  agents: successAgents,
  summaries: successAgents.map((agent) => ({
    agent,
    stance: "support",
    recommendation: "ok",
    objections: [],
    risks: [],
    confidence: "high",
    openQuestions: [],
  })),
  keyObjections: [],
  sharedRisks: [],
  openQuestions: [],
  questionResolutions: [],
  questionResolutionLimit: 0,
  deferredQuestions: [],
});

describe("selectAgentsForRound", () => {
  const agents = [makeAgent("alpha"), makeAgent("beta"), makeAgent("gamma")];

  describe('policy="all"', () => {
    it("returns all agents on round 1 with no prior packet", () => {
      const decision = selectAgentsForRound(agents, 1, null, "all");
      expect(decision.selected).toEqual(["alpha", "beta", "gamma"]);
      expect(decision.policy).toBe("all");
      expect(decision.round).toBe(1);
    });

    it("returns all agents on later rounds regardless of prior packet", () => {
      const packet = makePacket(["alpha"]); // only alpha succeeded
      const decision = selectAgentsForRound(agents, 2, packet, "all");
      expect(decision.selected).toEqual(["alpha", "beta", "gamma"]);
    });

    it("returns all agents when no prior packet on later round", () => {
      const decision = selectAgentsForRound(agents, 3, null, "all");
      expect(decision.selected).toEqual(["alpha", "beta", "gamma"]);
    });

    it("reason mentions policy=all for rounds > 1", () => {
      const decision = selectAgentsForRound(
        agents,
        2,
        makePacket(["alpha"]),
        "all",
      );
      expect(decision.reason).toContain("policy=all");
    });

    it("reason mentions round 1 for round 1", () => {
      const decision = selectAgentsForRound(agents, 1, null, "all");
      expect(decision.reason).toContain("round 1");
    });
  });

  describe('policy="addressed-only"', () => {
    it("returns all agents on round 1 regardless of prior packet", () => {
      const decision = selectAgentsForRound(agents, 1, null, "addressed-only");
      expect(decision.selected).toEqual(["alpha", "beta", "gamma"]);
    });

    it("returns all agents when prior packet is null on round > 1", () => {
      const decision = selectAgentsForRound(agents, 2, null, "addressed-only");
      expect(decision.selected).toEqual(["alpha", "beta", "gamma"]);
    });

    it("filters to agents that succeeded in prior round", () => {
      const packet = makePacket(["alpha", "gamma"]); // beta failed
      const decision = selectAgentsForRound(
        agents,
        2,
        packet,
        "addressed-only",
      );
      expect(decision.selected).toEqual(["alpha", "gamma"]);
      expect(decision.selected).not.toContain("beta");
    });

    it("falls back to all agents when no prior successes", () => {
      const emptyPacket = makePacket([]); // no successes
      const decision = selectAgentsForRound(
        agents,
        2,
        emptyPacket,
        "addressed-only",
      );
      expect(decision.selected).toEqual(["alpha", "beta", "gamma"]);
      expect(decision.reason).toContain("falling back to all agents");
    });

    it("preserves original agent order in selected list", () => {
      const packet = makePacket(["gamma", "alpha"]); // out of order
      const decision = selectAgentsForRound(
        agents,
        2,
        packet,
        "addressed-only",
      );
      // should match order of agents array, not packet
      expect(decision.selected).toEqual(["alpha", "gamma"]);
    });

    it("reason references the prior round number", () => {
      const packet = makePacket(["alpha"]);
      const decision = selectAgentsForRound(
        agents,
        3,
        packet,
        "addressed-only",
      );
      expect(decision.reason).toContain("round 2");
    });

    it("includes count of selected agents in reason", () => {
      const packet = makePacket(["alpha", "beta"]);
      const decision = selectAgentsForRound(
        agents,
        2,
        packet,
        "addressed-only",
      );
      expect(decision.reason).toContain("2 agent(s)");
    });

    it("returns correct decision fields", () => {
      const packet = makePacket(["beta"]);
      const decision = selectAgentsForRound(
        agents,
        4,
        packet,
        "addressed-only",
      );
      expect(decision.round).toBe(4);
      expect(decision.policy).toBe("addressed-only");
      expect(decision.selected).toEqual(["beta"]);
    });
  });

  describe("scheduler:decision event kind", () => {
    it("is a valid RunEventKind", () => {
      const result = RunEventKindSchema.safeParse("scheduler:decision");
      expect(result.success).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles single-agent list with all policy", () => {
      const single = [makeAgent("solo")];
      const decision = selectAgentsForRound(single, 1, null, "all");
      expect(decision.selected).toEqual(["solo"]);
    });

    it("handles single-agent list with addressed-only on round 2", () => {
      const single = [makeAgent("solo")];
      const packet = makePacket(["solo"]);
      const decision = selectAgentsForRound(
        single,
        2,
        packet,
        "addressed-only",
      );
      expect(decision.selected).toEqual(["solo"]);
    });

    it("ignores agents in prior packet that are not in the current agent list", () => {
      const packet = makePacket(["ghost", "alpha"]); // ghost not in agents
      const decision = selectAgentsForRound(
        agents,
        2,
        packet,
        "addressed-only",
      );
      expect(decision.selected).toEqual(["alpha"]);
      expect(decision.selected).not.toContain("ghost");
    });
  });
});
