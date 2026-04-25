import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AgentDefinition,
  ResolvedAgentRuntime,
  RunManifest,
  RunEvent,
  RoundPacket,
  MessageEnvelope,
} from "../schemas/index.js";
import type { BackendAdapter } from "../backends/index.js";
import type { SwarmRunConfig } from "./config.js";
import { createRoundRunner } from "./round-runner.js";
import type {
  AgentRuntimeResolver,
  BackendAdapterResolver,
  RoundResult,
} from "./round-runner.js";
import {
  selectAgentsForRound,
  type SchedulerDecision,
  type SchedulerPolicy,
} from "./scheduler.js";
import { ArtifactWriter } from "./artifact-writer.js";
import { buildRunDirName } from "./artifact-writer.js";
import {
  buildSeedBrief,
  buildRoundBrief,
  buildOrchestratorPassDirective,
} from "./brief-generator.js";
import { buildOrchestratorSynthesis } from "./synthesis.js";
import { attachLiveRenderer, attachQuietLogger } from "../ui/index.js";
import { OutputRouter } from "./output-router.js";
import type { OutputTarget } from "./output-router.js";
import { LedgerWriter } from "./ledger-writer.js";
import { InboxManager } from "./inbox-manager.js";
import { CheckpointWriter } from "./checkpoint-writer.js";

export type SwarmUiMode = "live" | "quiet" | "silent";

export interface ResumeSwarmOpts {
  config: SwarmRunConfig;
  agents: AgentDefinition[];
  backend: BackendAdapter;
  /** Directory of the interrupted run to resume from */
  runDir: string;
  ui?: SwarmUiMode;
  additionalTargets?: OutputTarget[];
  schedulerPolicy?: SchedulerPolicy;
  /**
   * Per-agent adapter resolver. When provided, each agent dispatches via
   * the adapter returned for it; `backend` is the default fallback and is
   * still used for run-level metadata such as wrapperName.
   */
  resolveBackend?: BackendAdapterResolver;
  /**
   * Per-agent runtime resolver. Returns the ResolvedAgentRuntime for each
   * agent so artifacts can record what actually ran (harness + model).
   */
  resolveRuntime?: AgentRuntimeResolver;
  /**
   * Resolved runtimes captured for the run. Persisted to manifest.json so
   * post-hoc tooling can inspect what harness/model each agent ran with.
   */
  agentRuntimes?: readonly ResolvedAgentRuntime[];
}

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
  /**
   * Wake-selection policy for each round. Defaults to "all" (every agent
   * runs every round). Use "addressed-only" to restrict later rounds to
   * agents that successfully responded in the prior round.
   */
  schedulerPolicy?: SchedulerPolicy;
  /**
   * Per-agent adapter resolver. When provided, each agent dispatches via
   * the adapter returned for it; `backend` is the default fallback and is
   * still used for run-level metadata such as wrapperName.
   */
  resolveBackend?: BackendAdapterResolver;
  /**
   * Per-agent runtime resolver. Returns the ResolvedAgentRuntime for each
   * agent so artifacts can record what actually ran (harness + model).
   */
  resolveRuntime?: AgentRuntimeResolver;
  /**
   * Resolved runtimes captured for the run. Persisted to manifest.json so
   * post-hoc tooling can inspect what harness/model each agent ran with.
   */
  agentRuntimes?: readonly ResolvedAgentRuntime[];
}

function didRoundSucceed(agentResults: RoundResult["agentResults"]): boolean {
  return agentResults.filter((r) => r.ok).length >= 2;
}

function roundPacketsToResults(packets: RoundPacket[]): RoundResult[] {
  return packets.map((packet, index) => ({
    round: typeof packet.round === "number" ? packet.round : index + 1,
    agentResults: [],
    packet,
  }));
}

function checkpointRoundResults(roundResults: RoundResult[]) {
  return roundResults.map(({ round, agentResults, packet }) => ({
    round,
    packet,
    agentResults: agentResults.map(({ agent, ok, output, error }) => ({
      agent,
      ok,
      output,
      error,
    })),
  }));
}

function restoreCheckpointRoundResults(
  checkpointResults: NonNullable<
    import("../schemas/index.js").RunCheckpoint["completedRoundResults"]
  >,
): RoundResult[] {
  return checkpointResults.map(({ round, agentResults, packet }) => ({
    round,
    packet,
    agentResults: agentResults.map(({ agent, ok, output, error }) => ({
      agent,
      ok,
      output,
      error,
      raw: null,
    })),
  }));
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
    ...(opts.agentRuntimes ? { agentRuntimes: [...opts.agentRuntimes] } : {}),
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
  const checkpoint = new CheckpointWriter(runDir);
  const inbox = new InboxManager(ledger);
  const router = new OutputRouter([
    writer,
    ledger,
    ...(opts.additionalTargets ?? []),
  ]);
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

  // Track round briefs for artifact writing
  const roundBriefs = new Map<number, string>();
  let priorPacket: RoundPacket | null = null;
  let orchestratorDirective: string | undefined = undefined;
  const completedRoundPackets: RoundPacket[] = [];
  const completedRoundResults: RoundResult[] = [];
  const pendingRoundWrites = new Map<number, Promise<void>>();
  const activeRoundMessages = new Map<number, Set<string>>();

  const awaitRoundWrite = async (round: number) => {
    const pending = pendingRoundWrites.get(round);
    if (pending) await pending;
  };

  const betweenRounds = async ({
    round,
    packet,
  }: {
    round: number;
    packet: RoundPacket;
  }) => {
    await awaitRoundWrite(round);

    const directive = buildOrchestratorPassDirective(packet);
    orchestratorDirective = directive;

    const directiveRecipients = selectAgentsForRound(
      agents,
      round + 1,
      packet,
      opts.schedulerPolicy ?? "all",
    ).selected;
    const message: MessageEnvelope = {
      messageId: randomUUID(),
      senderId: "orchestrator",
      recipients: directiveRecipients,
      kind: "broadcast",
      payload: { directive, fromRound: round },
      deliveryStatus: "staged",
      createdAt: new Date().toISOString(),
      roundNumber: round + 1,
    };
    inbox.stage(message);
    let activeMessages = activeRoundMessages.get(round + 1);
    if (!activeMessages) {
      activeMessages = new Set();
      activeRoundMessages.set(round + 1, activeMessages);
    }
    activeMessages.add(message.messageId);
    ledger.appendEvent(makeEvent("orchestrator:pass", { roundNumber: round }));
    // Checkpoint after the directive is durable so resumed round N+1 receives
    // the same orchestrator guidance as an uninterrupted run.
    checkpoint.write({
      runId: manifest.runId,
      lastCompletedRound: round,
      priorPacket: packet,
      completedRoundPackets: [...completedRoundPackets],
      completedRoundResults: checkpointRoundResults(completedRoundResults),
      orchestratorDirective: directive,
      checkpointedAt: new Date().toISOString(),
      startedAt: startedAtIso,
    });
    ledger.appendEvent(makeEvent("round:completed", { roundNumber: round }));

    return { directive };
  };

  const { emitter, run } = createRoundRunner({
    config,
    agents,
    backend,
    betweenRounds,
    schedulerPolicy: opts.schedulerPolicy,
    resolveBackend: opts.resolveBackend,
    resolveRuntime: opts.resolveRuntime,
  });

  const uiMode: SwarmUiMode =
    opts.ui ?? (process.stderr.isTTY ? "live" : "quiet");
  let liveHandle: { destroy: () => void } | null = null;
  if (uiMode === "live") {
    liveHandle = attachLiveRenderer(emitter);
  } else if (uiMode === "quiet") {
    attachQuietLogger(emitter);
  }

  emitter.on(
    "round:start",
    ({
      round,
      agents: agentNames,
      schedulerDecision,
    }: {
      round: number;
      agents: string[];
      schedulerDecision: SchedulerDecision;
    }) => {
      const brief =
        round === 1
          ? seedBrief
          : buildRoundBrief({
              config,
              round,
              seedBrief,
              priorPacket,
              orchestratorDirective,
            });
      roundBriefs.set(round, brief);
      ledger.appendEvent(
        makeEvent("scheduler:decision", {
          roundNumber: round,
          metadata: {
            policy: schedulerDecision.policy,
            selected: schedulerDecision.selected,
            reason: schedulerDecision.reason,
          },
        }),
      );
      ledger.appendEvent(makeEvent("round:started", { roundNumber: round }));
      for (const agentName of agentNames) {
        const message: MessageEnvelope = {
          messageId: randomUUID(),
          senderId: "orchestrator",
          recipients: [agentName],
          kind: "task",
          payload: { brief, round },
          deliveryStatus: "staged",
          createdAt: new Date().toISOString(),
          roundNumber: round,
        };
        inbox.stage(message);
        let activeMessages = activeRoundMessages.get(round);
        if (!activeMessages) {
          activeMessages = new Set();
          activeRoundMessages.set(round, activeMessages);
        }
        activeMessages.add(message.messageId);
      }
    },
  );

  emitter.on(
    "agent:start",
    ({ round, agent }: { round: number; agent: string }) => {
      const activeMessages = activeRoundMessages.get(round);
      inbox.commit(
        agent,
        (message) => activeMessages?.has(message.messageId) ?? false,
      );
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
      packet: RoundPacket;
      agentResults: RoundResult["agentResults"];
    }) => {
      const brief = roundBriefs.get(round) ?? "";
      const roundResult: RoundResult = { round, agentResults, packet };
      const pending = router.writeRound(roundResult, brief).then(() => {
        if (!didRoundSucceed(agentResults)) return;

        priorPacket = packet;
        completedRoundPackets.push(packet);
        completedRoundResults.push(roundResult);
        if (round < config.rounds) return;

        checkpoint.write({
          runId: manifest.runId,
          lastCompletedRound: round,
          priorPacket: packet,
          completedRoundPackets: [...completedRoundPackets],
          completedRoundResults: checkpointRoundResults(completedRoundResults),
          orchestratorDirective,
          checkpointedAt: new Date().toISOString(),
          startedAt: startedAtIso,
        });
        ledger.appendEvent(
          makeEvent("round:completed", { roundNumber: round }),
        );
      });
      pendingRoundWrites.set(round, pending);
    },
  );

  try {
    const result = await run();
    await Promise.all(pendingRoundWrites.values());

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

/**
 * Resume an interrupted swarm run from its checkpoint.
 *
 * Reads the durable checkpoint and message ledger from `runDir`,
 * rehydrates in-memory state, and continues the round loop from the
 * first round that was not yet completed. The same runDir and runId
 * are reused so artifacts are appended to the existing run directory.
 *
 * Throws if no checkpoint exists in `runDir`.
 */
export async function resumeSwarm(opts: ResumeSwarmOpts): Promise<number> {
  const { config, agents, backend } = opts;
  const { runDir } = opts;

  const checkpointWriter = new CheckpointWriter(runDir);
  const savedCheckpoint = checkpointWriter.read();
  if (!savedCheckpoint) {
    throw new Error(`Cannot resume: no valid checkpoint found in ${runDir}`);
  }

  const {
    runId,
    lastCompletedRound,
    priorPacket,
    orchestratorDirective,
    startedAt,
  } = savedCheckpoint;
  const resumedFromRoundPackets =
    savedCheckpoint.completedRoundPackets &&
    savedCheckpoint.completedRoundPackets.length > 0
      ? savedCheckpoint.completedRoundPackets
      : [priorPacket];
  const resumedRoundResults =
    savedCheckpoint.completedRoundResults &&
    savedCheckpoint.completedRoundResults.length > 0
      ? restoreCheckpointRoundResults(savedCheckpoint.completedRoundResults)
      : roundPacketsToResults(resumedFromRoundPackets);

  const ledger = new LedgerWriter(runDir);
  const inbox = new InboxManager(ledger);
  inbox.rehydrate(ledger.readMessages());

  const manifest: RunManifest = {
    runId,
    status: "running",
    topic: config.topic,
    rounds: config.rounds,
    backend: config.backend,
    preset: config.preset,
    goal: config.goal,
    decision: config.decision,
    agents: config.agents,
    ...(opts.agentRuntimes ? { agentRuntimes: [...opts.agentRuntimes] } : {}),
    resolveMode: config.resolveMode,
    startedAt,
    runDir,
  };

  const seedBrief = buildSeedBrief(config);

  const writer = new ArtifactWriter({
    baseDir: runDir,
    manifest,
    seedBrief,
    wrapperName: backend.wrapperName ?? `${config.backend}-cli`,
  });
  const checkpoint = checkpointWriter;
  const router = new OutputRouter([
    writer,
    ledger,
    ...(opts.additionalTargets ?? []),
  ]);

  // On resume: init only the ledger (idempotent append-only touch) and any
  // additional targets. ArtifactWriter.init() must NOT run — it would
  // overwrite the existing manifest.json and seed-brief.md.
  await ledger.init();
  for (const t of opts.additionalTargets ?? []) await t.init();

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

  ledger.appendEvent(
    makeEvent("run:resumed", {
      metadata: { resumedFromRound: lastCompletedRound },
    }),
  );

  const roundBriefs = new Map<number, string>();
  let currentPriorPacket: RoundPacket | null = priorPacket;
  let currentOrchestratorDirective: string | undefined = orchestratorDirective;
  const completedRoundPackets: RoundPacket[] = resumedRoundResults.map(
    (result) => result.packet,
  );
  const completedRoundResults: RoundResult[] = [...resumedRoundResults];
  const pendingRoundWrites = new Map<number, Promise<void>>();
  const startRound = lastCompletedRound + 1;
  const activeRoundMessages = new Map<number, Set<string>>();
  for (const recipient of inbox.stagedRecipients()) {
    for (const message of inbox.getStaged(recipient)) {
      if (message.roundNumber === startRound && message.kind === "broadcast") {
        let activeMessages = activeRoundMessages.get(startRound);
        if (!activeMessages) {
          activeMessages = new Set();
          activeRoundMessages.set(startRound, activeMessages);
        }
        activeMessages.add(message.messageId);
      }
    }
  }

  const awaitRoundWrite = async (round: number) => {
    const pending = pendingRoundWrites.get(round);
    if (pending) await pending;
  };

  const betweenRounds = async ({
    round,
    packet,
  }: {
    round: number;
    packet: RoundPacket;
  }) => {
    await awaitRoundWrite(round);

    const directive = buildOrchestratorPassDirective(packet);
    currentOrchestratorDirective = directive;

    const directiveRecipients = selectAgentsForRound(
      agents,
      round + 1,
      packet,
      opts.schedulerPolicy ?? "all",
    ).selected;
    const message: MessageEnvelope = {
      messageId: randomUUID(),
      senderId: "orchestrator",
      recipients: directiveRecipients,
      kind: "broadcast",
      payload: { directive, fromRound: round },
      deliveryStatus: "staged",
      createdAt: new Date().toISOString(),
      roundNumber: round + 1,
    };
    inbox.stage(message);
    let activeMessages = activeRoundMessages.get(round + 1);
    if (!activeMessages) {
      activeMessages = new Set();
      activeRoundMessages.set(round + 1, activeMessages);
    }
    activeMessages.add(message.messageId);
    ledger.appendEvent(makeEvent("orchestrator:pass", { roundNumber: round }));
    checkpoint.write({
      runId: manifest.runId,
      lastCompletedRound: round,
      priorPacket: packet,
      completedRoundPackets: [...completedRoundPackets],
      completedRoundResults: checkpointRoundResults(completedRoundResults),
      orchestratorDirective: directive,
      checkpointedAt: new Date().toISOString(),
      startedAt,
    });
    ledger.appendEvent(makeEvent("round:completed", { roundNumber: round }));

    return { directive };
  };

  const { emitter, run } = createRoundRunner({
    config,
    agents,
    backend,
    betweenRounds,
    schedulerPolicy: opts.schedulerPolicy,
    resolveBackend: opts.resolveBackend,
    resolveRuntime: opts.resolveRuntime,
    startRound,
    initialPriorPacket: priorPacket,
    initialOrchestratorDirective: orchestratorDirective,
  });

  const uiMode: SwarmUiMode =
    opts.ui ?? (process.stderr.isTTY ? "live" : "quiet");
  let liveHandle: { destroy: () => void } | null = null;
  if (uiMode === "live") {
    liveHandle = attachLiveRenderer(emitter);
  } else if (uiMode === "quiet") {
    attachQuietLogger(emitter);
  }

  emitter.on(
    "round:start",
    ({
      round,
      agents: agentNames,
      schedulerDecision,
    }: {
      round: number;
      agents: string[];
      schedulerDecision: SchedulerDecision;
    }) => {
      const brief =
        round === 1
          ? seedBrief
          : buildRoundBrief({
              config,
              round,
              seedBrief,
              priorPacket: currentPriorPacket,
              orchestratorDirective: currentOrchestratorDirective,
            });
      roundBriefs.set(round, brief);
      ledger.appendEvent(
        makeEvent("scheduler:decision", {
          roundNumber: round,
          metadata: {
            policy: schedulerDecision.policy,
            selected: schedulerDecision.selected,
            reason: schedulerDecision.reason,
          },
        }),
      );
      ledger.appendEvent(makeEvent("round:started", { roundNumber: round }));
      for (const agentName of agentNames) {
        const message: MessageEnvelope = {
          messageId: randomUUID(),
          senderId: "orchestrator",
          recipients: [agentName],
          kind: "task",
          payload: { brief, round },
          deliveryStatus: "staged",
          createdAt: new Date().toISOString(),
          roundNumber: round,
        };
        inbox.stage(message);
        let activeMessages = activeRoundMessages.get(round);
        if (!activeMessages) {
          activeMessages = new Set();
          activeRoundMessages.set(round, activeMessages);
        }
        activeMessages.add(message.messageId);
      }
    },
  );

  emitter.on(
    "agent:start",
    ({ round, agent }: { round: number; agent: string }) => {
      const activeMessages = activeRoundMessages.get(round);
      inbox.commit(
        agent,
        (message) => activeMessages?.has(message.messageId) ?? false,
      );
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
      packet: RoundPacket;
      agentResults: RoundResult["agentResults"];
    }) => {
      const brief = roundBriefs.get(round) ?? "";
      const roundResult: RoundResult = { round, agentResults, packet };
      const pending = router.writeRound(roundResult, brief).then(() => {
        if (!didRoundSucceed(agentResults)) return;

        currentPriorPacket = packet;
        completedRoundPackets.push(packet);
        completedRoundResults.push(roundResult);
        if (round < config.rounds) return;

        checkpoint.write({
          runId: manifest.runId,
          lastCompletedRound: round,
          priorPacket: packet,
          completedRoundPackets: [...completedRoundPackets],
          completedRoundResults: checkpointRoundResults(completedRoundResults),
          orchestratorDirective: currentOrchestratorDirective,
          checkpointedAt: new Date().toISOString(),
          startedAt,
        });
        ledger.appendEvent(
          makeEvent("round:completed", { roundNumber: round }),
        );
      });
      pendingRoundWrites.set(round, pending);
    },
  );

  try {
    const result = await run();
    await Promise.all(pendingRoundWrites.values());

    if (result.ok) {
      const synthesis = buildOrchestratorSynthesis(manifest, [
        ...resumedRoundResults,
        ...result.rounds,
      ]);
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
