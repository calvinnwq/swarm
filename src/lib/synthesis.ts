import type {
  Confidence,
  RoundPacket,
  RunManifest,
  SynthesisJson,
  StanceTally,
} from "../schemas/index.js";
import type { RoundResult } from "./round-runner.js";

export interface SynthesisResult {
  json: SynthesisJson;
  markdown: string;
}

/**
 * Deterministic (no-LLM) orchestrator synthesis.
 * Aggregates round outputs into a final synthesis.json + synthesis.md.
 */
export function buildOrchestratorSynthesis(
  manifest: RunManifest,
  allRounds: RoundResult[],
): SynthesisResult {
  const lastRound = allRounds[allRounds.length - 1];
  const lastPacket = lastRound.packet;

  const stanceTally = computeStanceTally(allRounds);
  const consensus = stanceTally.length === 1;
  const topRecommendation = pickTopRecommendation(lastPacket);
  const topRecommendationBasis = pickRecommendationBasis(allRounds);
  const sharedRisks = dedupeStrings(
    allRounds.flatMap((r) => r.packet.sharedRisks),
  );
  const keyObjections = dedupeStrings(
    allRounds.flatMap((r) => r.packet.keyObjections),
  );
  const openQuestions = dedupeStrings(lastPacket.openQuestions);
  const deferredQuestions = dedupeStrings(lastPacket.deferredQuestions);
  const overallConfidence = computeOverallConfidence(lastPacket);

  const json: SynthesisJson = {
    topic: manifest.topic,
    rounds: manifest.rounds,
    agents: manifest.agents,
    resolveMode: manifest.resolveMode,
    consensus,
    stanceTally,
    topRecommendation,
    topRecommendationBasis,
    sharedRisks,
    keyObjections,
    openQuestions,
    deferredQuestions,
    overallConfidence,
    roundCount: allRounds.length,
    agentCount: manifest.agents.length,
  };

  const markdown = renderSynthesisMarkdown(json, allRounds);
  return { json, markdown };
}

function computeStanceTally(allRounds: RoundResult[]): StanceTally[] {
  const lastRound = allRounds[allRounds.length - 1];
  const map = new Map<string, string[]>();

  for (const summary of lastRound.packet.summaries) {
    const stance = summary.stance;
    const existing = map.get(stance);
    if (existing) {
      existing.push(summary.agent);
    } else {
      map.set(stance, [summary.agent]);
    }
  }

  return [...map.entries()]
    .map(([stance, agents]) => ({ stance, agents, count: agents.length }))
    .sort((a, b) => b.count - a.count);
}

function pickTopRecommendation(lastPacket: RoundPacket): string {
  if (lastPacket.summaries.length === 0) return "";

  // Pick the recommendation from the highest-confidence agent in the last round.
  // On ties, prefer the first agent alphabetically for determinism.
  const sorted = [...lastPacket.summaries].sort((a, b) => {
    const confDiff =
      confidenceRank(b.confidence) - confidenceRank(a.confidence);
    if (confDiff !== 0) return confDiff;
    return a.agent.localeCompare(b.agent);
  });
  return sorted[0].recommendation;
}

function pickRecommendationBasis(allRounds: RoundResult[]): string[] {
  const lastRound = allRounds[allRounds.length - 1];
  // Collect reasoning from all successful agents in the last round
  const basis: string[] = [];
  for (const result of lastRound.agentResults) {
    if (result.ok && result.output) {
      for (const reason of result.output.reasoning) {
        if (!basis.includes(reason)) {
          basis.push(reason);
        }
      }
    }
  }
  return basis;
}

function confidenceRank(c: Confidence): number {
  switch (c) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function computeOverallConfidence(lastPacket: RoundPacket): Confidence {
  if (lastPacket.summaries.length === 0) return "low";
  const ranks = lastPacket.summaries.map((s) => confidenceRank(s.confidence));
  const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  if (avg >= 2.5) return "high";
  if (avg >= 1.5) return "medium";
  return "low";
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function renderSynthesisMarkdown(
  synthesis: SynthesisJson,
  allRounds: RoundResult[],
): string {
  const lines: string[] = [];

  lines.push(`# Synthesis: ${synthesis.topic}`);
  lines.push("");
  lines.push(
    `**${synthesis.roundCount} round(s)** | **${synthesis.agentCount} agent(s)** | resolve: **${synthesis.resolveMode}** | confidence: **${synthesis.overallConfidence}**`,
  );
  lines.push("");

  // Consensus
  lines.push("## Consensus");
  lines.push("");
  if (synthesis.consensus) {
    lines.push(`All agents converged on: ${synthesis.stanceTally[0].stance}`);
  } else {
    lines.push("Agents did not reach full consensus. Stance breakdown:");
    lines.push("");
    for (const tally of synthesis.stanceTally) {
      lines.push(
        `- **${tally.stance}** (${tally.count}): ${tally.agents.join(", ")}`,
      );
    }
  }
  lines.push("");

  // Top recommendation
  lines.push("## Top Recommendation");
  lines.push("");
  lines.push(synthesis.topRecommendation);
  lines.push("");
  if (synthesis.topRecommendationBasis.length > 0) {
    lines.push("### Basis");
    lines.push("");
    for (const reason of synthesis.topRecommendationBasis) {
      lines.push(`- ${reason}`);
    }
    lines.push("");
  }

  // Shared risks
  if (synthesis.sharedRisks.length > 0) {
    lines.push("## Shared Risks");
    lines.push("");
    for (const risk of synthesis.sharedRisks) {
      lines.push(`- ${risk}`);
    }
    lines.push("");
  }

  // Key objections
  if (synthesis.keyObjections.length > 0) {
    lines.push("## Key Objections");
    lines.push("");
    for (const obj of synthesis.keyObjections) {
      lines.push(`- ${obj}`);
    }
    lines.push("");
  }

  // Open questions
  if (synthesis.openQuestions.length > 0) {
    lines.push("## Open Questions");
    lines.push("");
    for (const q of synthesis.openQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }

  // Deferred questions
  if (synthesis.deferredQuestions.length > 0) {
    lines.push("## Deferred Questions");
    lines.push("");
    for (const q of synthesis.deferredQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }

  // Round-by-round summary
  lines.push("## Round-by-Round Summary");
  lines.push("");
  for (const round of allRounds) {
    lines.push(`### Round ${round.round}`);
    lines.push("");
    for (const summary of round.packet.summaries) {
      lines.push(
        `- **${summary.agent}** [${summary.confidence}]: ${summary.recommendation}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
