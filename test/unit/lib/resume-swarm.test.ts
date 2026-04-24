import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentDefinition,
  AgentOutput,
} from "../../../src/schemas/index.js";
import type { BackendAdapter } from "../../../src/backends/index.js";
import type { SwarmRunConfig } from "../../../src/lib/config.js";
import type { RunCheckpoint } from "../../../src/schemas/run-checkpoint.js";
import type { RoundPacket } from "../../../src/schemas/index.js";
import type {
  AgentResult,
  RoundResult,
} from "../../../src/lib/round-runner.js";

// --- Mock factories ---

const destroyMock = vi.fn();
const initMock = vi.fn();
const finalizeMock = vi.fn();
const writeRoundMock = vi.fn();
const writeSynthesisMock = vi.fn();
const runMock = vi.fn();
const emitterMock = new EventEmitter();

const checkpointReadMock = vi.fn<() => RunCheckpoint | null>();
const checkpointWriteMock = vi.fn();
const ledgerReadMessagesMock = vi.fn(() => []);
const ledgerAppendEventMock = vi.fn();
const ledgerAppendMessageMock = vi.fn();
const inboxRehydrateMock = vi.fn();
const inboxStageMock = vi.fn();
const inboxCommitMock = vi.fn();

vi.mock("../../../src/lib/round-runner.js", () => ({
  createRoundRunner: vi.fn(() => ({
    emitter: emitterMock,
    run: runMock,
  })),
}));

vi.mock("../../../src/lib/artifact-writer.js", () => ({
  ArtifactWriter: vi.fn(function ArtifactWriter() {
    return {
      init: initMock,
      finalize: finalizeMock,
      writeRound: writeRoundMock,
      writeSynthesis: writeSynthesisMock,
    };
  }),
  buildRunDirName: vi.fn(() => "run-dir"),
}));

vi.mock("../../../src/lib/checkpoint-writer.js", () => ({
  CheckpointWriter: vi.fn(function CheckpointWriter() {
    return {
      read: checkpointReadMock,
      write: checkpointWriteMock,
    };
  }),
}));

vi.mock("../../../src/lib/ledger-writer.js", () => ({
  LedgerWriter: vi.fn(function LedgerWriter() {
    return {
      init: vi.fn(),
      finalize: vi.fn(),
      writeRound: vi.fn(),
      writeSynthesis: vi.fn(),
      appendEvent: ledgerAppendEventMock,
      appendMessage: ledgerAppendMessageMock,
      readMessages: ledgerReadMessagesMock,
      readEvents: vi.fn(() => []),
      getLastCompletedRound: vi.fn(() => 0),
    };
  }),
}));

vi.mock("../../../src/lib/inbox-manager.js", () => ({
  InboxManager: vi.fn(function InboxManager() {
    return {
      rehydrate: inboxRehydrateMock,
      stage: inboxStageMock,
      commit: inboxCommitMock,
      getStaged: vi.fn(() => []),
      getCommitted: vi.fn(() => []),
      stagedRecipients: vi.fn(() => []),
    };
  }),
}));

vi.mock("../../../src/lib/synthesis.js", () => ({
  buildOrchestratorSynthesis: vi.fn(() => ({ summary: "ok" })),
}));

vi.mock("../../../src/lib/brief-generator.js", () => ({
  buildSeedBrief: vi.fn(() => "seed brief"),
  buildRoundBrief: vi.fn(() => "round brief"),
  buildOrchestratorPassDirective: vi.fn(() => "pass directive"),
}));

vi.mock("../../../src/ui/index.js", () => ({
  attachLiveRenderer: vi.fn(() => ({ destroy: destroyMock })),
  attachQuietLogger: vi.fn(),
}));

// --- Helpers ---

const config: SwarmRunConfig = {
  topic: "topic",
  rounds: 3,
  backend: "claude",
  preset: null,
  agents: ["alpha", "beta"],
  selectionSource: "explicit-agents",
  resolveMode: "off",
  goal: null,
  decision: null,
  docs: [],
  commandText: "swarm run 3 topic --agents alpha,beta",
};

const agents: AgentDefinition[] = [
  {
    name: "alpha",
    description: "a",
    persona: "a",
    prompt: "a",
    backend: "claude",
  },
  {
    name: "beta",
    description: "b",
    persona: "b",
    prompt: "b",
    backend: "claude",
  },
];

const backend = {} as BackendAdapter;

const priorPacket: RoundPacket = {
  round: 2,
  agents: ["alpha", "beta"],
  summaries: [],
  keyObjections: [],
  sharedRisks: [],
  openQuestions: [],
  questionResolutions: [],
  questionResolutionLimit: 3,
  deferredQuestions: [],
};

const checkpoint: RunCheckpoint = {
  runId: "00000000-0000-0000-0000-000000000001",
  lastCompletedRound: 2,
  priorPacket,
  orchestratorDirective: "focus on risks",
  checkpointedAt: "2026-04-24T00:00:00.000Z",
  startedAt: "2026-04-20T10:00:00.000Z",
};

const round3Output: AgentOutput = {
  agent: "alpha",
  round: 3,
  stance: "support",
  recommendation: "finish",
  reasoning: ["new round basis"],
  objections: [],
  risks: [],
  changesFromPriorRound: ["continued"],
  confidence: "high",
  openQuestions: [],
};

const round3Result: AgentResult = {
  agent: "alpha",
  ok: true,
  output: round3Output,
  raw: null,
  error: null,
};

const resumedRound: RoundResult = {
  round: 3,
  agentResults: [round3Result],
  packet: {
    round: 3,
    agents: ["alpha"],
    summaries: [
      {
        agent: "alpha",
        stance: "support",
        recommendation: "finish",
        objections: [],
        risks: [],
        confidence: "high",
        openQuestions: [],
      },
    ],
    keyObjections: [],
    sharedRisks: [],
    openQuestions: [],
    questionResolutions: [],
    questionResolutionLimit: 0,
    deferredQuestions: [],
  },
};

describe("resumeSwarm", () => {
  beforeEach(() => {
    destroyMock.mockReset();
    initMock.mockReset();
    finalizeMock.mockReset();
    writeRoundMock.mockReset();
    writeSynthesisMock.mockReset();
    runMock.mockReset();
    checkpointReadMock.mockReset();
    checkpointWriteMock.mockReset();
    ledgerReadMessagesMock.mockReset().mockReturnValue([]);
    ledgerAppendEventMock.mockReset();
    ledgerAppendMessageMock.mockReset();
    inboxRehydrateMock.mockReset();
    inboxStageMock.mockReset();
    inboxCommitMock.mockReset();
    emitterMock.removeAllListeners();
  });

  it("throws when no checkpoint exists in runDir", async () => {
    checkpointReadMock.mockReturnValue(null);
    const { resumeSwarm } = await import("../../../src/lib/run-swarm.js");

    await expect(
      resumeSwarm({
        config,
        agents,
        backend,
        runDir: "/tmp/run-1",
        ui: "silent",
      }),
    ).rejects.toThrow("Cannot resume: no valid checkpoint found in /tmp/run-1");
  });

  it("returns 0 on successful resume", async () => {
    checkpointReadMock.mockReturnValue(checkpoint);
    runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

    const { resumeSwarm } = await import("../../../src/lib/run-swarm.js");
    const code = await resumeSwarm({
      config,
      agents,
      backend,
      runDir: "/tmp/run-1",
      ui: "silent",
    });

    expect(code).toBe(0);
  });

  it("returns 1 when resumed run fails", async () => {
    checkpointReadMock.mockReturnValue(checkpoint);
    runMock.mockResolvedValue({ rounds: [], ok: false, error: "fail" });

    const { resumeSwarm } = await import("../../../src/lib/run-swarm.js");
    const code = await resumeSwarm({
      config,
      agents,
      backend,
      runDir: "/tmp/run-1",
      ui: "silent",
    });

    expect(code).toBe(1);
  });

  it("rehydrates the inbox from messages.jsonl before starting", async () => {
    checkpointReadMock.mockReturnValue(checkpoint);
    runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

    const { resumeSwarm } = await import("../../../src/lib/run-swarm.js");
    await resumeSwarm({
      config,
      agents,
      backend,
      runDir: "/tmp/run-1",
      ui: "silent",
    });

    expect(ledgerReadMessagesMock).toHaveBeenCalled();
    expect(inboxRehydrateMock).toHaveBeenCalledWith([]);
  });

  it("emits run:resumed event with resumedFromRound metadata", async () => {
    checkpointReadMock.mockReturnValue(checkpoint);
    runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

    const { resumeSwarm } = await import("../../../src/lib/run-swarm.js");
    await resumeSwarm({
      config,
      agents,
      backend,
      runDir: "/tmp/run-1",
      ui: "silent",
    });

    const resumedEvent = ledgerAppendEventMock.mock.calls.find(
      ([event]) => (event as { kind: string }).kind === "run:resumed",
    );
    expect(resumedEvent).toBeDefined();
    expect(resumedEvent![0].metadata).toEqual({ resumedFromRound: 2 });
  });

  it("passes startRound = lastCompletedRound + 1 to createRoundRunner", async () => {
    checkpointReadMock.mockReturnValue(checkpoint);
    runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

    const { createRoundRunner } =
      await import("../../../src/lib/round-runner.js");
    const { resumeSwarm } = await import("../../../src/lib/run-swarm.js");
    await resumeSwarm({
      config,
      agents,
      backend,
      runDir: "/tmp/run-1",
      ui: "silent",
    });

    expect(createRoundRunner).toHaveBeenCalledWith(
      expect.objectContaining({ startRound: 3 }),
    );
  });

  it("passes initialPriorPacket and initialOrchestratorDirective to createRoundRunner", async () => {
    checkpointReadMock.mockReturnValue(checkpoint);
    runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

    const { createRoundRunner } =
      await import("../../../src/lib/round-runner.js");
    const { resumeSwarm } = await import("../../../src/lib/run-swarm.js");
    await resumeSwarm({
      config,
      agents,
      backend,
      runDir: "/tmp/run-1",
      ui: "silent",
    });

    expect(createRoundRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPriorPacket: priorPacket,
        initialOrchestratorDirective: "focus on risks",
      }),
    );
  });

  it("uses the stored runId from the checkpoint (not a fresh UUID)", async () => {
    checkpointReadMock.mockReturnValue(checkpoint);
    runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

    const { resumeSwarm } = await import("../../../src/lib/run-swarm.js");
    await resumeSwarm({
      config,
      agents,
      backend,
      runDir: "/tmp/run-1",
      ui: "silent",
    });

    const runStartedCall = ledgerAppendEventMock.mock.calls.find(
      ([event]) => (event as { kind: string }).kind === "run:resumed",
    );
    expect(runStartedCall![0].runId).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
  });

  it("writes synthesis on successful resume completion", async () => {
    checkpointReadMock.mockReturnValue(checkpoint);
    runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

    const { resumeSwarm } = await import("../../../src/lib/run-swarm.js");
    await resumeSwarm({
      config,
      agents,
      backend,
      runDir: "/tmp/run-1",
      ui: "silent",
    });

    expect(writeSynthesisMock).toHaveBeenCalled();
  });

  it("includes checkpointed rounds when synthesizing a successful resume", async () => {
    checkpointReadMock.mockReturnValue(checkpoint);
    runMock.mockResolvedValue({
      rounds: [resumedRound],
      ok: true,
      error: null,
    });

    const { buildOrchestratorSynthesis } =
      await import("../../../src/lib/synthesis.js");
    const { resumeSwarm } = await import("../../../src/lib/run-swarm.js");
    await resumeSwarm({
      config,
      agents,
      backend,
      runDir: "/tmp/run-1",
      ui: "silent",
    });

    expect(buildOrchestratorSynthesis).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({ round: 2, packet: priorPacket }),
      resumedRound,
    ]);
  });

  it("does not write synthesis when resumed run fails", async () => {
    checkpointReadMock.mockReturnValue(checkpoint);
    runMock.mockResolvedValue({
      rounds: [],
      ok: false,
      error: "agent failure",
    });

    const { resumeSwarm } = await import("../../../src/lib/run-swarm.js");
    await resumeSwarm({
      config,
      agents,
      backend,
      runDir: "/tmp/run-1",
      ui: "silent",
    });

    expect(writeSynthesisMock).not.toHaveBeenCalled();
  });

  it("preserves the original run's startedAt from the checkpoint (B1)", async () => {
    checkpointReadMock.mockReturnValue(checkpoint);
    runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

    const { ArtifactWriter } =
      await import("../../../src/lib/artifact-writer.js");
    const { resumeSwarm } = await import("../../../src/lib/run-swarm.js");
    await resumeSwarm({
      config,
      agents,
      backend,
      runDir: "/tmp/run-1",
      ui: "silent",
    });

    const opts = vi.mocked(ArtifactWriter).mock.calls[0][0];
    expect(opts.manifest.startedAt).toBe("2026-04-20T10:00:00.000Z");
  });

  it("betweenRounds writes checkpoint with the fresh directive (not the stale prior-round value)", async () => {
    checkpointReadMock.mockReturnValue(checkpoint);
    runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

    const { createRoundRunner } =
      await import("../../../src/lib/round-runner.js");
    const { resumeSwarm } = await import("../../../src/lib/run-swarm.js");
    await resumeSwarm({
      config,
      agents,
      backend,
      runDir: "/tmp/run-1",
      ui: "silent",
    });

    const opts = vi.mocked(createRoundRunner).mock.calls.at(-1)![0];
    const testPacket = { ...priorPacket, round: 3 };

    checkpointWriteMock.mockReset();
    inboxStageMock.mockReset();
    await opts.betweenRounds?.({ round: 3, packet: testPacket });

    // buildOrchestratorPassDirective is mocked to return "pass directive"
    expect(checkpointWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({ orchestratorDirective: "pass directive" }),
    );
    expect(inboxStageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "broadcast",
        recipients: ["alpha", "beta"],
      }),
    );
  });

  it("does not call ArtifactWriter.init on resume, preserving the existing manifest.json (B2)", async () => {
    checkpointReadMock.mockReturnValue(checkpoint);
    runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

    const { resumeSwarm } = await import("../../../src/lib/run-swarm.js");
    await resumeSwarm({
      config,
      agents,
      backend,
      runDir: "/tmp/run-1",
      ui: "silent",
    });

    expect(initMock).not.toHaveBeenCalled();
  });
});
