import type { RoundPacket } from "../schemas/index.js";
import type { SwarmRunConfig } from "./config.js";

const OUTPUT_CONTRACT_FIELDS =
  "agent, round, stance, recommendation, reasoning, objections, risks, changesFromPriorRound, confidence, openQuestions";

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

export function buildSeedBrief(config: SwarmRunConfig): string {
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
    "Return the shared swarm JSON schema with fields:",
    OUTPUT_CONTRACT_FIELDS,
    "",
    "## Round instructions",
    ...ROUND_INSTRUCTIONS,
  );

  if (config.resolveMode !== "off") {
    lines.push(
      "",
      "## Resolution mode",
      config.resolveMode === "orchestrator"
        ? "Explicit resolution is enabled. The orchestrator runs the question-resolution sub-pass between rounds before continuing."
        : "Explicit resolution is enabled. The selected swarm agents run the question-resolution sub-pass between rounds before continuing.",
    );
  }

  return lines.join("\n").trim() + "\n";
}

export interface BuildRoundBriefArgs {
  config: SwarmRunConfig;
  round: number;
  seedBrief: string;
  priorPacket: RoundPacket | null;
}

export function buildRoundBrief(args: BuildRoundBriefArgs): string {
  const { config, round, seedBrief, priorPacket } = args;

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

  lines.push("## Instructions", ...ROUND_BRIEF_INSTRUCTIONS, "");

  return lines.join("\n").trimEnd() + "\n";
}
