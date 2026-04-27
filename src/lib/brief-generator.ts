import type { RoundPacket } from "../schemas/index.js";
import type { SwarmRunConfig } from "./config.js";
import type { CarryForwardDocPacket } from "./doc-inputs.js";

const OUTPUT_CONTRACT_BLOCK = [
  "Return a single JSON object matching this exact shape (no extra fields):",
  "  agent: string",
  "  round: number",
  "  stance: string",
  "  recommendation: string",
  "  reasoning: string[]",
  "  objections: string[]",
  "  risks: string[]",
  "  changesFromPriorRound: string[]   // use [] in round 1",
  '  confidence: "low" | "medium" | "high"',
  "  openQuestions: string[]",
  "Return ONLY the JSON object (optionally inside a ```json fenced block). No prose before or after.",
].join("\n");

const ROUND_INSTRUCTIONS = [
  "Round 1: independent stance + recommendation + risks.",
  "Round 2: respond to the compacted round-1 packet.",
  "Round 3: converge or finalize only.",
];

const ROUND_BRIEF_INSTRUCTIONS = [
  "Stay inside the shared swarm JSON schema.",
  "Make your answer concise, concrete, and round-aware.",
  "If questionResolutions appear in the prior round packet, treat the top blocking ones as the swarm's current working answers unless you are explicitly overturning them.",
  "If a prior questionResolution is marked deferred, leave it parked unless you now have enough evidence in-round to answer it cleanly.",
  "If this is not the final round, respond to the prior packet rather than restating the seed brief.",
];

export function buildSeedBrief(
  config: SwarmRunConfig,
  carryForwardDocPackets: readonly CarryForwardDocPacket[] = [],
): string {
  const lines: string[] = [
    "# Swarm Brief",
    "",
    `Topic: ${config.topic}`,
    `Rounds: ${config.rounds}`,
    `Selection source: ${config.selectionSource}`,
    `Preset: ${config.preset ?? "none"}`,
    `Agents: ${config.agents.join(", ")}`,
    `Resolution mode: ${config.resolveMode}`,
    `Goal: ${config.goal ?? "n/a"}`,
    `Decision target: ${config.decision ?? "n/a"}`,
    `Carry-forward docs: ${config.docs.length > 0 ? config.docs.join(", ") : "n/a"}`,
  ];

  if (config.docs.length > 0) {
    lines.push("", "## Carry-forward context docs");
    for (const doc of config.docs) {
      lines.push(`- ${doc}`);
    }
    lines.push(
      "Treat these docs as prior context to reference, critique, refine, or build on. They are inputs, not untouchable truth.",
    );
  }

  if (carryForwardDocPackets.length > 0) {
    lines.push(
      "",
      "## Carry-forward doc excerpts",
      "These bounded excerpts are the packed carry-forward context for this run. Use the provenance to distinguish source context from generated round output.",
    );
    for (const packet of carryForwardDocPackets) {
      const truncation = packet.truncated ? " (truncated)" : "";
      const fence = markdownFenceFor(packet.content);
      lines.push(
        "",
        `### ${packet.path}`,
        `Included chars: ${packet.includedCharCount}/${packet.originalCharCount}${truncation}`,
        `Excerpt range: ${packet.provenance.excerptStart}-${packet.provenance.excerptEnd}`,
        `SHA-256: ${packet.provenance.sha256}`,
        "",
        `${fence}text`,
        packet.content,
        fence,
      );
    }
  }

  if (config.goal || config.decision) {
    lines.push(
      "",
      "## Intent",
      `Goal: ${config.goal ?? "n/a"}`,
      `Decision target: ${config.decision ?? "n/a"}`,
      "Use these as the lens for your recommendation. Do not debate in the abstract if the command defines a concrete goal or decision target.",
    );
  }

  lines.push(
    "",
    "## Output contract",
    OUTPUT_CONTRACT_BLOCK,
    "",
    "## Round instructions",
    ...ROUND_INSTRUCTIONS,
  );

  return lines.join("\n").trim() + "\n";
}

function markdownFenceFor(content: string): string {
  const longestBacktickRun = Math.max(
    2,
    ...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
  );
  return "`".repeat(longestBacktickRun + 1);
}

export interface BuildRoundBriefArgs {
  config: SwarmRunConfig;
  round: number;
  seedBrief: string;
  priorPacket: RoundPacket | null;
  orchestratorDirective?: string;
}

export function buildRoundBrief(args: BuildRoundBriefArgs): string {
  const { config, round, seedBrief, priorPacket, orchestratorDirective } = args;

  const lines: string[] = [
    "# Swarm Round Brief",
    "",
    `Topic: ${config.topic}`,
    `Round: ${round}/${config.rounds}`,
    `Preset: ${config.preset ?? "none"}`,
    `Agents: ${config.agents.join(", ")}`,
    `Selection source: ${config.selectionSource}`,
    "",
    "## Seed Brief",
    seedBrief.trimEnd(),
    "",
    "## Prior Round Packet",
  ];

  if (priorPacket === null) {
    lines.push("No prior round packet yet. This is the opening round.", "");
  } else {
    lines.push("```json", JSON.stringify(priorPacket, null, 2), "```", "");
  }

  if (orchestratorDirective) {
    lines.push(orchestratorDirective, "");
  }

  lines.push("## Instructions", ...ROUND_BRIEF_INSTRUCTIONS, "");

  return lines.join("\n").trimEnd() + "\n";
}

export function buildOrchestratorPassDirective(packet: RoundPacket): string {
  const lines: string[] = [
    `## Orchestrator Pass — After Round ${packet.round}`,
    "",
  ];

  if (packet.summaries.length > 0) {
    lines.push(`**Stance summary (${packet.summaries.length} agent(s)):**`);
    for (const s of packet.summaries) {
      lines.push(`- ${s.agent}: ${s.stance}`);
    }
    lines.push("");
  }

  if (packet.keyObjections.length > 0) {
    lines.push("**Key objections to address this round:**");
    for (const o of packet.keyObjections) {
      lines.push(`- ${o}`);
    }
    lines.push("");
  }

  if (packet.sharedRisks.length > 0) {
    lines.push("**Shared risks (flagged by 2+ agents):**");
    for (const r of packet.sharedRisks) {
      lines.push(`- ${r}`);
    }
    lines.push("");
  }

  if (packet.openQuestions.length > 0) {
    lines.push("**Open questions to resolve:**");
    for (const q of packet.openQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
