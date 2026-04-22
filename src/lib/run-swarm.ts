import { join } from "node:path";
import type { AgentDefinition, RunManifest } from "../schemas/index.js";
import type { BackendAdapter } from "../backends/index.js";
import type { SwarmRunConfig } from "./config.js";
import { createRoundRunner } from "./round-runner.js";
import type { RoundResult } from "./round-runner.js";
import { ArtifactWriter } from "./artifact-writer.js";
import { buildRunDirName } from "./artifact-writer.js";
import { buildSeedBrief, buildRoundBrief } from "./brief-generator.js";
import { buildOrchestratorSynthesis } from "./synthesis.js";
import { attachLiveRenderer, attachQuietLogger } from "../ui/index.js";

export type SwarmUiMode = "live" | "quiet" | "silent";

export interface RunSwarmOpts {
  config: SwarmRunConfig;
  agents: AgentDefinition[];
  backend: BackendAdapter;
  /** Base directory for run artifacts (default: ".swarm/runs") */
  baseDir?: string;
  /** Override start time for deterministic output */
  startedAt?: Date;
  /**
   * Terminal output mode. Defaults to "live" when stderr is a TTY, else "quiet".
   * "silent" disables UI attachment (artifacts still written).
   */
  ui?: SwarmUiMode;
}

/**
 * Full pipeline orchestrator: runs rounds, writes artifacts, synthesizes.
 * Returns 0 on success, 1 on failure.
 */
export async function runSwarm(opts: RunSwarmOpts): Promise<number> {
  const { config, agents, backend } = opts;
  const baseDir = opts.baseDir ?? ".swarm/runs";
  const startedAt = opts.startedAt ?? new Date();
  const startedAtIso = startedAt.toISOString();

  const runDir = join(baseDir, buildRunDirName(startedAt, config.topic));

  const manifest: RunManifest = {
    topic: config.topic,
    rounds: config.rounds,
    preset: config.preset,
    goal: config.goal,
    decision: config.decision,
    agents: config.agents,
    resolveMode: config.resolveMode,
    startedAt: startedAtIso,
    runDir,
  };

  const seedBrief = buildSeedBrief(config);

  const writer = new ArtifactWriter({ baseDir, manifest, seedBrief });
  writer.init();

  const { emitter, run } = createRoundRunner({
    config,
    agents,
    backend,
  });

  const uiMode: SwarmUiMode =
    opts.ui ?? (process.stderr.isTTY ? "live" : "quiet");
  let liveHandle: { destroy: () => void } | null = null;
  if (uiMode === "live") {
    liveHandle = attachLiveRenderer(emitter);
  } else if (uiMode === "quiet") {
    attachQuietLogger(emitter);
  }

  // Track round briefs for artifact writing
  const roundBriefs = new Map<number, string>();
  let priorPacket: import("../schemas/index.js").RoundPacket | null = null;

  emitter.on("round:start", ({ round }: { round: number }) => {
    const brief =
      round === 1
        ? seedBrief
        : buildRoundBrief({ config, round, seedBrief, priorPacket });
    roundBriefs.set(round, brief);
  });

  emitter.on(
    "round:done",
    ({
      round,
      packet,
      agentResults,
    }: {
      round: number;
      packet: import("../schemas/index.js").RoundPacket;
      agentResults: import("./round-runner.js").AgentResult[];
    }) => {
      const brief = roundBriefs.get(round) ?? "";
      const roundResult: RoundResult = { round, agentResults, packet };
      writer.writeRound(roundResult, brief);
      priorPacket = packet;
    },
  );

  try {
    const result = await run();

    if (result.ok) {
      const synthesis = buildOrchestratorSynthesis(manifest, result.rounds);
      writer.writeSynthesis(synthesis);
    }

    const finishedAt = new Date().toISOString();
    writer.finalize(finishedAt);

    return result.ok ? 0 : 1;
  } finally {
    liveHandle?.destroy();
  }
}
