import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
import { OutputRouter } from "./output-router.js";
import type { OutputTarget } from "./output-router.js";
import { LedgerWriter } from "./ledger-writer.js";
import { InboxManager } from "./inbox-manager.js";
import type { RunEvent } from "../schemas/index.js";

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
  /**
   * Additional output targets routed alongside the default disk writer.
   * Each target receives the same lifecycle events: init, writeRound,
   * writeSynthesis, and finalize.
   */
  additionalTargets?: OutputTarget[];
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
    runId: randomUUID(),
    status: "running",
    topic: config.topic,
    rounds: config.rounds,
    backend: config.backend,
    preset: config.preset,
    goal: config.goal,
    decision: config.decision,
    agents: config.agents,
    resolveMode: config.resolveMode,
    startedAt: startedAtIso,
    runDir,
  };

  const seedBrief = buildSeedBrief(config);

  const writer = new ArtifactWriter({
    baseDir,
    manifest,
    seedBrief,
    wrapperName: backend.wrapperName ?? `${config.backend}-cli`,
  });
  const ledger = new LedgerWriter(runDir);
  const inbox = new InboxManager(ledger);
  const router = new OutputRouter([writer, ledger, ...(opts.additionalTargets ?? [])]);
  await router.init();

  const makeEvent = (
    kind: RunEvent["kind"],
    extra?: Pick<RunEvent, "roundNumber" | "agentName" | "metadata">,
  ): RunEvent => ({
    eventId: randomUUID(),
    kind,
    runId: manifest.runId,
    occurredAt: new Date().toISOString(),
    ...extra,
  });

  ledger.appendEvent(makeEvent("run:started"));

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

  emitter.on("round:start", ({ round, agents: agentNames }: { round: number; agents: string[] }) => {
    const brief =
      round === 1
        ? seedBrief
        : buildRoundBrief({ config, round, seedBrief, priorPacket });
    roundBriefs.set(round, brief);
    ledger.appendEvent(makeEvent("round:started", { roundNumber: round }));
    for (const agentName of agentNames) {
      inbox.stage({
        messageId: randomUUID(),
        senderId: "orchestrator",
        recipients: [agentName],
        kind: "task",
        payload: { brief, round },
        deliveryStatus: "staged",
        createdAt: new Date().toISOString(),
        roundNumber: round,
      });
    }
  });

  emitter.on(
    "agent:start",
    ({ round, agent }: { round: number; agent: string }) => {
      inbox.commit(agent);
      ledger.appendEvent(
        makeEvent("agent:started", { roundNumber: round, agentName: agent }),
      );
    },
  );

  emitter.on(
    "agent:ok",
    ({ round, agent }: { round: number; agent: string }) => {
      ledger.appendEvent(
        makeEvent("agent:completed", { roundNumber: round, agentName: agent }),
      );
    },
  );

  emitter.on(
    "agent:fail",
    ({ round, agent }: { round: number; agent: string }) => {
      ledger.appendEvent(
        makeEvent("agent:failed", { roundNumber: round, agentName: agent }),
      );
    },
  );

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
      void router.writeRound(roundResult, brief);
      ledger.appendEvent(makeEvent("round:completed", { roundNumber: round }));
      priorPacket = packet;
    },
  );

  try {
    const result = await run();

    if (result.ok) {
      const synthesis = buildOrchestratorSynthesis(manifest, result.rounds);
      await router.writeSynthesis(synthesis);
    }

    ledger.appendEvent(makeEvent(result.ok ? "run:completed" : "run:failed"));
    const finishedAt = new Date().toISOString();
    const finalStatus = result.ok ? "done" : "failed";
    await router.finalize(finishedAt, finalStatus);

    return result.ok ? 0 : 1;
  } finally {
    liveHandle?.destroy();
  }
}
