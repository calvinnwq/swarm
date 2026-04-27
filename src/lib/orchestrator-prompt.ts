import type { RoundPacket } from "../schemas/index.js";

export interface BuildOrchestratorResolutionPromptArgs {
  packet: RoundPacket;
  goal: string | null;
  decision: string | null;
  /** The round this resolution pass produces a directive for (typically packet.round + 1). */
  nextRound: number;
}

const ORCHESTRATOR_OUTPUT_CONTRACT = [
  "Return a single JSON object matching this exact shape:",
  "  round: number",
  "  directive: string",
  "  questionResolutions: QuestionResolution[]",
  "  questionResolutionLimit: number",
  "  deferredQuestions: string[]",
  '  confidence: "low" | "medium" | "high"',
  "",
  "Each QuestionResolution must have:",
  "  question: string",
  '  status: "consensus" | "directional" | "deferred"',
  "  answer: string",
  "  basis: string",
  '  confidence: "low" | "medium" | "high"',
  "  askedBy: string[]",
  "  supportingAgents: string[]",
  "  supportingReasoning: string[]",
  "  relatedObjections: string[]",
  "  relatedRisks: string[]",
  "  blockingScore: number   // integer >= 0",
  "",
  "Return ONLY the JSON object (optionally inside a ```json fenced block). No prose before or after.",
].join("\n");

const RESOLUTION_INSTRUCTIONS = [
  "Resolve only the open questions that are clearly answered by evidence in the source packet — explicit agreement, shared reasoning, or a strong recommendation backed by stance.",
  'Mark a question as "consensus" only when at least two agents back the same answer with reasoning visible in the packet.',
  'Mark a question as "directional" when the prior round leans the same way without unanimous backing.',
  "Defer any question that lacks evidence in the packet by adding it to deferredQuestions. Do not speculate or invent an answer.",
  "Keep directive short and round-aware — describe what the next round should focus on given the resolutions.",
  "Set round to the upcoming round number (the round that has not yet started).",
];

export function buildOrchestratorResolutionPrompt(
  args: BuildOrchestratorResolutionPromptArgs,
): string {
  const { packet, goal, decision, nextRound } = args;

  const completedRound = packet.round ?? 0;
  const lines: string[] = [
    "# Orchestrator Resolution Pass",
    "",
    `You are the swarm orchestrator. The agents just completed round ${completedRound}.`,
    `Produce the resolution packet for Round ${nextRound}.`,
    "",
    "## Intent",
    `Goal: ${goal ?? "n/a"}`,
    `Decision target: ${decision ?? "n/a"}`,
    "",
    "## Source packet",
    "The sub-sections below are the source-of-truth context produced by the agents in the prior round. Do not invent additional facts.",
  ];

  if (packet.summaries.length > 0) {
    lines.push("", "### Stance summary");
    for (const s of packet.summaries) {
      lines.push(
        `- ${s.agent} (${s.confidence}): ${s.stance} — ${s.recommendation}`,
      );
    }
  }

  if (packet.openQuestions.length > 0) {
    lines.push("", "### Open questions");
    for (const q of packet.openQuestions) {
      lines.push(`- ${q}`);
    }
  }

  if (packet.keyObjections.length > 0) {
    lines.push("", "### Key objections");
    for (const o of packet.keyObjections) {
      lines.push(`- ${o}`);
    }
  }

  if (packet.sharedRisks.length > 0) {
    lines.push("", "### Shared risks (flagged by 2+ agents)");
    for (const r of packet.sharedRisks) {
      lines.push(`- ${r}`);
    }
  }

  if (packet.questionResolutions.length > 0) {
    lines.push("", "### Prior resolutions");
    for (const r of packet.questionResolutions) {
      lines.push(`- [${r.status}] ${r.question} → ${r.answer}`);
    }
  }

  if (packet.deferredQuestions.length > 0) {
    lines.push("", "### Previously deferred questions");
    for (const q of packet.deferredQuestions) {
      lines.push(`- ${q}`);
    }
  }

  lines.push(
    "",
    "## Instructions",
    ...RESOLUTION_INSTRUCTIONS,
    "",
    "## Output contract",
    ORCHESTRATOR_OUTPUT_CONTRACT,
  );

  return lines.join("\n").trimEnd() + "\n";
}
