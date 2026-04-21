import { describe, it, expect } from "vitest";
import { buildOrchestratorSynthesis } from "../../../src/lib/synthesis.js";
import { SynthesisSchema } from "../../../src/schemas/synthesis.js";
import type {
  RunManifest,
  RoundPacket,
  AgentOutput,
} from "../../../src/schemas/index.js";
import type {
  RoundResult,
  AgentResult,
} from "../../../src/lib/round-runner.js";

function makeAgentOutput(
  overrides: Partial<AgentOutput> & { agent: string; round: number },
): AgentOutput {
  return {
    stance: "Adopt option B",
    recommendation: "Ship option B as MVP",
    reasoning: ["Simpler architecture", "Faster time to market"],
    objections: ["Couples data to transport"],
    risks: ["Contract may change post-ship"],
    changesFromPriorRound: [],
    confidence: "high" as const,
    openQuestions: ["Rollback plan?"],
    ...overrides,
  };
}

function makeAgentResult(output: AgentOutput): AgentResult {
  return {
    agent: output.agent,
    ok: true,
    output,
    raw: {
      ok: true,
      exitCode: 0,
      stdout: "{}",
      stderr: "",
      timedOut: false,
      durationMs: 1000,
    },
    error: null,
  };
}

function makeRoundPacket(round: number, outputs: AgentOutput[]): RoundPacket {
  const summaries = outputs.map((o) => ({
    agent: o.agent,
    stance: o.stance,
    recommendation: o.recommendation,
    objections: o.objections,
    risks: o.risks,
    confidence: o.confidence,
    openQuestions: o.openQuestions,
  }));

  const riskCounts = new Map<string, number>();
  for (const o of outputs) {
    for (const risk of o.risks) {
      riskCounts.set(risk, (riskCounts.get(risk) ?? 0) + 1);
    }
  }
  const sharedRisks = [...riskCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([risk]) => risk);

  return {
    round,
    agents: outputs.map((o) => o.agent),
    summaries,
    keyObjections: outputs.flatMap((o) => o.objections),
    sharedRisks,
    openQuestions: outputs.flatMap((o) => o.openQuestions),
    questionResolutions: [],
    questionResolutionLimit: 0,
    deferredQuestions: [],
  };
}

function makeRoundResult(round: number, outputs: AgentOutput[]): RoundResult {
  return {
    round,
    agentResults: outputs.map(makeAgentResult),
    packet: makeRoundPacket(round, outputs),
  };
}

const baseManifest: RunManifest = {
  topic: "Should we adopt microservices?",
  rounds: 2,
  preset: null,
  agents: ["product-manager", "principal-engineer"],
  resolveMode: "orchestrator",
  startedAt: "2026-04-19T10:00:00Z",
  runDir: ".swarm/runs/20260419-100000-microservices",
};

const r1pm = makeAgentOutput({
  agent: "product-manager",
  round: 1,
  stance: "Adopt microservices for the payments domain",
  recommendation: "Start with payments extraction as the first bounded context",
  reasoning: [
    "Payments is the highest-churn domain",
    "Independent deploy cadence reduces release risk",
  ],
  objections: ["Team lacks distributed-systems experience"],
  risks: ["Shared DB coupling risk", "Observability gap"],
  confidence: "medium",
  openQuestions: ["What is the latency budget for cross-service calls?"],
});

const r1eng = makeAgentOutput({
  agent: "principal-engineer",
  round: 1,
  stance: "Adopt microservices for the payments domain",
  recommendation: "Extract payments behind an API gateway first",
  reasoning: [
    "API gateway provides a clean seam",
    "Gateway enables canary routing",
  ],
  objections: ["Gateway adds a hop and operational burden"],
  risks: ["Shared DB coupling risk", "Schema migration coordination"],
  confidence: "high",
  openQuestions: ["Who owns the gateway?"],
});

const r2pm = makeAgentOutput({
  agent: "product-manager",
  round: 2,
  stance: "Adopt microservices for the payments domain",
  recommendation: "Ship payments extraction with a 2-week canary",
  reasoning: ["Canary reduces blast radius", "2 weeks gives enough signal"],
  objections: ["Canary infrastructure not yet proven"],
  risks: ["Shared DB coupling risk"],
  confidence: "high",
  openQuestions: ["Rollback plan?"],
});

const r2eng = makeAgentOutput({
  agent: "principal-engineer",
  round: 2,
  stance: "Adopt microservices for the payments domain",
  recommendation: "Ship payments extraction behind gateway with canary",
  reasoning: [
    "Gateway + canary is the safest path",
    "Shared DB can be migrated post-canary",
  ],
  objections: ["Post-canary DB migration timeline unclear"],
  risks: ["Shared DB coupling risk"],
  confidence: "high",
  openQuestions: [],
});

describe("buildOrchestratorSynthesis", () => {
  const allRounds = [
    makeRoundResult(1, [r1pm, r1eng]),
    makeRoundResult(2, [r2pm, r2eng]),
  ];

  const result = buildOrchestratorSynthesis(baseManifest, allRounds);

  it("produces JSON that validates against SynthesisSchema", () => {
    const parsed = SynthesisSchema.safeParse(result.json);
    expect(parsed.success).toBe(true);
  });

  it("reflects manifest metadata", () => {
    expect(result.json.topic).toBe("Should we adopt microservices?");
    expect(result.json.rounds).toBe(2);
    expect(result.json.agents).toEqual([
      "product-manager",
      "principal-engineer",
    ]);
    expect(result.json.resolveMode).toBe("orchestrator");
  });

  it("detects consensus when all agents share the same stance", () => {
    expect(result.json.consensus).toBe(true);
    expect(result.json.stanceTally).toHaveLength(1);
    expect(result.json.stanceTally[0].count).toBe(2);
  });

  it("picks the top recommendation from the highest-confidence agent", () => {
    // Both r2pm and r2eng are "high", alphabetically principal-engineer < product-manager
    expect(result.json.topRecommendation).toBe(r2eng.recommendation);
  });

  it("collects recommendation basis from last round reasoning", () => {
    expect(result.json.topRecommendationBasis).toContain(
      "Canary reduces blast radius",
    );
    expect(result.json.topRecommendationBasis).toContain(
      "Gateway + canary is the safest path",
    );
  });

  it("aggregates shared risks across all rounds with dedup", () => {
    expect(result.json.sharedRisks).toContain("Shared DB coupling risk");
  });

  it("aggregates key objections across all rounds", () => {
    expect(result.json.keyObjections.length).toBeGreaterThan(0);
  });

  it("collects open questions from last round", () => {
    expect(result.json.openQuestions).toContain("Rollback plan?");
  });

  it("computes overall confidence as average of last round", () => {
    // Both agents are "high" in round 2 → avg 3.0 → "high"
    expect(result.json.overallConfidence).toBe("high");
  });

  it("includes round and agent counts", () => {
    expect(result.json.roundCount).toBe(2);
    expect(result.json.agentCount).toBe(2);
  });

  // Markdown structure tests
  it("renders markdown with the expected top-level heading", () => {
    expect(result.markdown).toContain(
      "# Synthesis: Should we adopt microservices?",
    );
  });

  it("renders the metadata line", () => {
    expect(result.markdown).toContain("**2 round(s)**");
    expect(result.markdown).toContain("**2 agent(s)**");
    expect(result.markdown).toContain("resolve: **orchestrator**");
  });

  it("renders consensus section", () => {
    expect(result.markdown).toContain("## Consensus");
    expect(result.markdown).toContain("All agents converged on:");
  });

  it("renders round-by-round summary", () => {
    expect(result.markdown).toContain("## Round-by-Round Summary");
    expect(result.markdown).toContain("### Round 1");
    expect(result.markdown).toContain("### Round 2");
  });

  it("renders agent entries in round summaries", () => {
    expect(result.markdown).toContain("**product-manager** [high]:");
    expect(result.markdown).toContain("**principal-engineer** [high]:");
  });
});

describe("buildOrchestratorSynthesis — disagreement", () => {
  const r2pmDissent = makeAgentOutput({
    agent: "product-manager",
    round: 2,
    stance: "Defer microservices; monolith-first",
    recommendation: "Invest in modular monolith boundaries instead",
    reasoning: ["Team not ready for distributed systems"],
    objections: [],
    risks: ["Organizational overhead of microservices"],
    confidence: "low",
    openQuestions: ["When will the team be ready?"],
  });

  const allRounds = [
    makeRoundResult(1, [r1pm, r1eng]),
    makeRoundResult(2, [r2pmDissent, r2eng]),
  ];

  const result = buildOrchestratorSynthesis(baseManifest, allRounds);

  it("detects non-consensus when agents disagree", () => {
    expect(result.json.consensus).toBe(false);
    expect(result.json.stanceTally.length).toBeGreaterThan(1);
  });

  it("renders stance breakdown in markdown when no consensus", () => {
    expect(result.markdown).toContain("Agents did not reach full consensus");
    expect(result.markdown).toContain("Defer microservices; monolith-first");
    expect(result.markdown).toContain(
      "Adopt microservices for the payments domain",
    );
  });

  it("picks recommendation from higher-confidence agent on disagreement", () => {
    // r2eng is "high", r2pmDissent is "low" → picks r2eng
    expect(result.json.topRecommendation).toBe(r2eng.recommendation);
  });

  it("computes overall confidence as medium when mixed (high + low)", () => {
    // avg of 3 + 1 = 2.0 → "medium"
    expect(result.json.overallConfidence).toBe("medium");
  });
});

describe("buildOrchestratorSynthesis — single round", () => {
  const singleRoundManifest: RunManifest = {
    ...baseManifest,
    rounds: 1,
  };

  const allRounds = [makeRoundResult(1, [r1pm, r1eng])];
  const result = buildOrchestratorSynthesis(singleRoundManifest, allRounds);

  it("works with a single round", () => {
    expect(result.json.roundCount).toBe(1);
    const parsed = SynthesisSchema.safeParse(result.json);
    expect(parsed.success).toBe(true);
  });

  it("only has one round in the round-by-round summary", () => {
    expect(result.markdown).toContain("### Round 1");
    expect(result.markdown).not.toContain("### Round 2");
  });
});
