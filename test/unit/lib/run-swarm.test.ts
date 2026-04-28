import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentDefinition,
  AgentOutput,
  RoundPacket,
} from "../../../src/schemas/index.js";
import type { BackendAdapter } from "../../../src/backends/index.js";
import type { SwarmRunConfig } from "../../../src/lib/config.js";
import type { AgentResult } from "../../../src/lib/round-runner.js";

const destroyMock = vi.fn();
const initMock = vi.fn();
const finalizeMock = vi.fn();
const writeRoundMock = vi.fn();
const writeSynthesisMock = vi.fn();
const attachLiveRendererMock = vi.fn(() => ({ destroy: destroyMock }));
const attachQuietLoggerMock = vi.fn();
const runMock = vi.fn();
const emitterMock = new EventEmitter();
const checkpointWriteMock = vi.fn();
const ledgerAppendEventMock = vi.fn();
const inboxStageMock = vi.fn();
const dispatchOrchestratorPassMock = vi.fn();

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
    return { read: vi.fn(() => null), write: checkpointWriteMock };
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
      appendMessage: vi.fn(),
      readMessages: vi.fn(() => []),
      readEvents: vi.fn(() => []),
      getLastCompletedRound: vi.fn(() => 0),
    };
  }),
}));

vi.mock("../../../src/lib/inbox-manager.js", () => ({
  InboxManager: vi.fn(function InboxManager() {
    return {
      rehydrate: vi.fn(),
      stage: inboxStageMock,
      commit: vi.fn(),
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

vi.mock("../../../src/lib/orchestrator-dispatcher.js", () => ({
  dispatchOrchestratorPass: dispatchOrchestratorPassMock,
}));

vi.mock("../../../src/ui/index.js", () => ({
  attachLiveRenderer: attachLiveRendererMock,
  attachQuietLogger: attachQuietLoggerMock,
}));

describe("runSwarm", () => {
  beforeEach(() => {
    destroyMock.mockReset();
    initMock.mockReset();
    finalizeMock.mockReset();
    writeRoundMock.mockReset();
    writeSynthesisMock.mockReset();
    attachLiveRendererMock.mockClear();
    attachQuietLoggerMock.mockClear();
    runMock.mockReset();
    checkpointWriteMock.mockReset();
    ledgerAppendEventMock.mockReset();
    inboxStageMock.mockReset();
    dispatchOrchestratorPassMock.mockReset();
    emitterMock.removeAllListeners();
  });

  it("destroys the live renderer when execution throws", async () => {
    const { runSwarm } = await import("../../../src/lib/run-swarm.js");
    const error = new Error("boom");
    runMock.mockRejectedValueOnce(error);

    const config: SwarmRunConfig = {
      topic: "topic",
      rounds: 1,
      backend: "claude",
      preset: null,
      agents: ["product-manager", "principal-engineer"],
      selectionSource: "explicit-agents",
      resolveMode: "off",
      timeoutMs: 120_000,
      goal: null,
      decision: null,
      docs: [],
      commandText:
        "swarm run 1 topic --agents product-manager,principal-engineer",
    };

    const agents: AgentDefinition[] = [
      {
        name: "product-manager",
        description: "pm",
        persona: "pm",
        prompt: "pm",
        backend: "claude",
      },
      {
        name: "principal-engineer",
        description: "pe",
        persona: "pe",
        prompt: "pe",
        backend: "claude",
      },
    ];

    const backend = {} as BackendAdapter;

    await expect(
      runSwarm({ config, agents, backend, ui: "live" }),
    ).rejects.toThrow(error);

    expect(attachLiveRendererMock).toHaveBeenCalledTimes(1);
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("writes the seed brief as the persisted round-1 brief", async () => {
    const { runSwarm } = await import("../../../src/lib/run-swarm.js");
    runMock.mockImplementationOnce(async () => {
      emitterMock.emit("round:start", {
        round: 1,
        agents: ["product-manager"],
        schedulerDecision: {
          round: 1,
          policy: "all",
          selected: ["product-manager"],
          reason: "all agents wake on round 1",
        },
      });
      emitterMock.emit("round:done", {
        round: 1,
        packet: {
          round: 1,
          agents: ["product-manager"],
          summaries: [],
          keyObjections: [],
          sharedRisks: [],
          openQuestions: [],
          questionResolutions: [],
          questionResolutionLimit: 3,
          deferredQuestions: [],
        },
        agentResults: [],
      });
      return { rounds: [], ok: true, error: null };
    });

    const config: SwarmRunConfig = {
      topic: "topic",
      rounds: 1,
      backend: "claude",
      preset: null,
      agents: ["product-manager", "principal-engineer"],
      selectionSource: "explicit-agents",
      resolveMode: "off",
      timeoutMs: 120_000,
      goal: null,
      decision: null,
      docs: [],
      commandText:
        "swarm run 1 topic --agents product-manager,principal-engineer",
    };

    const agents: AgentDefinition[] = [
      {
        name: "product-manager",
        description: "pm",
        persona: "pm",
        prompt: "pm",
        backend: "claude",
      },
      {
        name: "principal-engineer",
        description: "pe",
        persona: "pe",
        prompt: "pe",
        backend: "claude",
      },
    ];

    const backend = {} as BackendAdapter;

    await expect(
      runSwarm({ config, agents, backend, ui: "silent" }),
    ).resolves.toBe(0);

    expect(writeRoundMock).toHaveBeenCalledWith(
      expect.objectContaining({ round: 1 }),
      "seed brief",
    );
  });

  it("does not mark failed rounds as completed checkpoints", async () => {
    const failedPacket: RoundPacket = {
      round: 1,
      agents: ["alpha", "beta"],
      summaries: [
        {
          agent: "alpha",
          stance: "support",
          recommendation: "ship",
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
    };
    const alphaOutput: AgentOutput = {
      agent: "alpha",
      round: 1,
      stance: "support",
      recommendation: "ship",
      reasoning: ["ok"],
      objections: [],
      risks: [],
      changesFromPriorRound: [],
      confidence: "high",
      openQuestions: [],
    };
    const agentResults: AgentResult[] = [
      {
        agent: "alpha",
        ok: true,
        output: alphaOutput,
        raw: null,
        error: null,
      },
      {
        agent: "beta",
        ok: false,
        output: null,
        raw: null,
        error: "boom",
      },
    ];
    runMock.mockImplementationOnce(async () => {
      emitterMock.emit("round:start", {
        round: 1,
        agents: ["alpha", "beta"],
        schedulerDecision: {
          round: 1,
          policy: "all",
          selected: ["alpha", "beta"],
          reason: "all agents wake on round 1",
        },
      });
      emitterMock.emit("round:done", {
        round: 1,
        packet: failedPacket,
        agentResults,
      });
      return {
        rounds: [{ round: 1, packet: failedPacket, agentResults }],
        ok: false,
        error: "Round 1 failed",
      };
    });

    const { runSwarm } = await import("../../../src/lib/run-swarm.js");
    const config: SwarmRunConfig = {
      topic: "topic",
      rounds: 1,
      backend: "claude",
      preset: null,
      agents: ["alpha", "beta"],
      selectionSource: "explicit-agents",
      resolveMode: "off",
      timeoutMs: 120_000,
      goal: null,
      decision: null,
      docs: [],
      commandText: "swarm run 1 topic --agents alpha,beta",
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

    const code = await runSwarm({
      config,
      agents,
      backend: {} as BackendAdapter,
      ui: "silent",
    });

    expect(code).toBe(1);
    expect(checkpointWriteMock).not.toHaveBeenCalled();
    expect(
      ledgerAppendEventMock.mock.calls.some(
        ([event]) => (event as { kind: string }).kind === "round:completed",
      ),
    ).toBe(false);
  });

  it("waits for round output writes before completing the round", async () => {
    let resolveWriteRound!: () => void;
    writeRoundMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveWriteRound = resolve;
      }),
    );

    const packet: RoundPacket = {
      round: 1,
      agents: ["alpha", "beta"],
      summaries: [],
      keyObjections: [],
      sharedRisks: [],
      openQuestions: [],
      questionResolutions: [],
      questionResolutionLimit: 0,
      deferredQuestions: [],
    };
    const agentResults: AgentResult[] = [
      { agent: "alpha", ok: true, output: null, raw: null, error: null },
      { agent: "beta", ok: true, output: null, raw: null, error: null },
    ];
    runMock.mockImplementationOnce(async () => {
      emitterMock.emit("round:start", {
        round: 1,
        agents: ["alpha", "beta"],
        schedulerDecision: {
          round: 1,
          policy: "all",
          selected: ["alpha", "beta"],
          reason: "all agents wake on round 1",
        },
      });
      emitterMock.emit("round:done", { round: 1, packet, agentResults });
      return {
        rounds: [{ round: 1, packet, agentResults }],
        ok: true,
        error: null,
      };
    });

    const { runSwarm } = await import("../../../src/lib/run-swarm.js");
    const config: SwarmRunConfig = {
      topic: "topic",
      rounds: 1,
      backend: "claude",
      preset: null,
      agents: ["alpha", "beta"],
      selectionSource: "explicit-agents",
      resolveMode: "off",
      timeoutMs: 120_000,
      goal: null,
      decision: null,
      docs: [],
      commandText: "swarm run 1 topic --agents alpha,beta",
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

    const promise = runSwarm({
      config,
      agents,
      backend: {} as BackendAdapter,
      ui: "silent",
    });
    await Promise.resolve();

    expect(
      ledgerAppendEventMock.mock.calls.some(
        ([event]) => (event as { kind: string }).kind === "round:completed",
      ),
    ).toBe(false);

    resolveWriteRound();
    await expect(promise).resolves.toBe(0);

    const roundCompletedCall = ledgerAppendEventMock.mock.calls.find(
      ([event]) => (event as { kind: string }).kind === "round:completed",
    );
    const runCompletedCall = ledgerAppendEventMock.mock.calls.find(
      ([event]) => (event as { kind: string }).kind === "run:completed",
    );
    expect(roundCompletedCall).toBeDefined();
    expect(runCompletedCall).toBeDefined();
    expect(roundCompletedCall![0]).toEqual(
      expect.objectContaining({ kind: "round:completed" }),
    );
  });

  it("betweenRounds writes checkpoint with the fresh directive (not the stale prior-round value)", async () => {
    runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

    const { createRoundRunner } =
      await import("../../../src/lib/round-runner.js");
    const { runSwarm } = await import("../../../src/lib/run-swarm.js");

    const config: SwarmRunConfig = {
      topic: "test topic",
      rounds: 3,
      backend: "claude",
      preset: null,
      agents: ["alpha"],
      selectionSource: "explicit-agents",
      resolveMode: "off",
      timeoutMs: 120_000,
      goal: null,
      decision: null,
      docs: [],
      commandText: "swarm run 3 test-topic --agents alpha",
    };
    const agents: AgentDefinition[] = [
      {
        name: "alpha",
        description: "a",
        persona: "a",
        prompt: "a",
        backend: "claude",
      },
    ];
    const backend = {} as BackendAdapter;

    await runSwarm({ config, agents, backend, ui: "silent" });

    // Extract the betweenRounds callback that was passed to createRoundRunner
    const opts = vi.mocked(createRoundRunner).mock.calls.at(-1)![0];
    const testPacket = {
      round: 1,
      agents: ["alpha"],
      summaries: [],
      keyObjections: [],
      sharedRisks: [],
      openQuestions: [],
      questionResolutions: [],
      questionResolutionLimit: 0,
      deferredQuestions: [],
    };

    // Reset to isolate writes that come from betweenRounds specifically
    checkpointWriteMock.mockReset();
    inboxStageMock.mockReset();
    await opts.betweenRounds?.({ round: 1, packet: testPacket });

    // buildOrchestratorPassDirective is mocked to return "pass directive"
    expect(checkpointWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({ orchestratorDirective: "pass directive" }),
    );
    expect(inboxStageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "broadcast",
        recipients: ["alpha"],
      }),
    );
  });

  describe('resolveMode === "orchestrator"', () => {
    const orchestratorAgent: AgentDefinition = {
      name: "orchestrator",
      description: "orch",
      persona: "orch",
      prompt: "orch",
      backend: "claude",
    };

    const baseAgents: AgentDefinition[] = [
      {
        name: "alpha",
        description: "a",
        persona: "a",
        prompt: "a",
        backend: "claude",
      },
    ];

    const baseConfig = (
      resolveMode: SwarmRunConfig["resolveMode"],
    ): SwarmRunConfig => ({
      topic: "topic",
      rounds: 3,
      backend: "claude",
      preset: null,
      agents: ["alpha"],
      selectionSource: "explicit-agents",
      resolveMode,
      timeoutMs: 120_000,
      goal: "ship",
      decision: "go-no-go",
      docs: [],
      commandText: "swarm run 3 topic --agents alpha",
    });

    const samplePacket: RoundPacket = {
      round: 1,
      agents: ["alpha"],
      summaries: [],
      keyObjections: [],
      sharedRisks: [],
      openQuestions: [],
      questionResolutions: [],
      questionResolutionLimit: 0,
      deferredQuestions: [],
    };

    it("dispatches the orchestrator pass and uses its directive when resolveMode is orchestrator", async () => {
      runMock.mockResolvedValue({ rounds: [], ok: true, error: null });
      dispatchOrchestratorPassMock.mockResolvedValue({
        ok: true,
        output: {
          round: 2,
          directive: "llm-derived directive",
          questionResolutions: [],
          questionResolutionLimit: 0,
          deferredQuestions: [],
          confidence: "high",
        },
        raw: {
          ok: true,
          exitCode: 0,
          stdout: "{}",
          stderr: "",
          timedOut: false,
          durationMs: 5,
        },
      });

      const { createRoundRunner } =
        await import("../../../src/lib/round-runner.js");
      const { runSwarm } = await import("../../../src/lib/run-swarm.js");

      const orchestratorBackendDispatch = vi.fn();
      const orchestratorBackend = {
        dispatch: orchestratorBackendDispatch,
      } as unknown as BackendAdapter;
      const resolveBackend = vi.fn(() => orchestratorBackend);

      await runSwarm({
        config: baseConfig("orchestrator"),
        agents: baseAgents,
        backend: {} as BackendAdapter,
        ui: "silent",
        orchestratorAgent,
        resolveBackend,
      });

      const opts = vi.mocked(createRoundRunner).mock.calls.at(-1)![0];
      checkpointWriteMock.mockReset();
      inboxStageMock.mockReset();
      await opts.betweenRounds?.({ round: 1, packet: samplePacket });

      expect(dispatchOrchestratorPassMock).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: orchestratorBackend,
          agent: orchestratorAgent,
          packet: samplePacket,
          goal: "ship",
          decision: "go-no-go",
          nextRound: 2,
        }),
      );
      expect(resolveBackend).toHaveBeenCalledWith(orchestratorAgent);
      expect(checkpointWriteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orchestratorDirective: "llm-derived directive",
        }),
      );
      expect(inboxStageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "broadcast",
          payload: expect.objectContaining({
            directive: "llm-derived directive",
          }),
        }),
      );
    });

    it("falls back to the default backend for the orchestrator agent when no resolver is provided", async () => {
      runMock.mockResolvedValue({ rounds: [], ok: true, error: null });
      dispatchOrchestratorPassMock.mockResolvedValue({
        ok: true,
        output: {
          round: 2,
          directive: "fallback directive",
          questionResolutions: [],
          questionResolutionLimit: 0,
          deferredQuestions: [],
          confidence: "medium",
        },
        raw: null,
      });

      const { createRoundRunner } =
        await import("../../../src/lib/round-runner.js");
      const { runSwarm } = await import("../../../src/lib/run-swarm.js");

      const defaultBackend = {} as BackendAdapter;

      await runSwarm({
        config: baseConfig("orchestrator"),
        agents: baseAgents,
        backend: defaultBackend,
        ui: "silent",
        orchestratorAgent,
      });

      const opts = vi.mocked(createRoundRunner).mock.calls.at(-1)![0];
      await opts.betweenRounds?.({ round: 1, packet: samplePacket });

      expect(dispatchOrchestratorPassMock).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: defaultBackend,
          agent: orchestratorAgent,
        }),
      );
    });

    it("passes the configured timeout to orchestrator dispatch", async () => {
      runMock.mockResolvedValue({ rounds: [], ok: true, error: null });
      dispatchOrchestratorPassMock.mockResolvedValue({
        ok: true,
        output: {
          round: 2,
          directive: "timeout-aware directive",
          questionResolutions: [],
          questionResolutionLimit: 0,
          deferredQuestions: [],
          confidence: "medium",
        },
        raw: null,
      });

      const { createRoundRunner } =
        await import("../../../src/lib/round-runner.js");
      const { runSwarm } = await import("../../../src/lib/run-swarm.js");

      await runSwarm({
        config: { ...baseConfig("orchestrator"), timeoutMs: 300_000 },
        agents: baseAgents,
        backend: {} as BackendAdapter,
        ui: "silent",
        orchestratorAgent,
      });

      const opts = vi.mocked(createRoundRunner).mock.calls.at(-1)![0];
      await opts.betweenRounds?.({ round: 1, packet: samplePacket });

      expect(dispatchOrchestratorPassMock).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 300_000 }),
      );
    });

    it("does not dispatch the orchestrator when resolveMode is off", async () => {
      runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

      const { createRoundRunner } =
        await import("../../../src/lib/round-runner.js");
      const { runSwarm } = await import("../../../src/lib/run-swarm.js");

      await runSwarm({
        config: baseConfig("off"),
        agents: baseAgents,
        backend: {} as BackendAdapter,
        ui: "silent",
        orchestratorAgent,
      });

      const opts = vi.mocked(createRoundRunner).mock.calls.at(-1)![0];
      await opts.betweenRounds?.({ round: 1, packet: samplePacket });

      expect(dispatchOrchestratorPassMock).not.toHaveBeenCalled();
    });

    it("does not dispatch the orchestrator when resolveMode is orchestrator but no orchestratorAgent is provided", async () => {
      runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

      const { createRoundRunner } =
        await import("../../../src/lib/round-runner.js");
      const { runSwarm } = await import("../../../src/lib/run-swarm.js");

      await runSwarm({
        config: baseConfig("orchestrator"),
        agents: baseAgents,
        backend: {} as BackendAdapter,
        ui: "silent",
      });

      const opts = vi.mocked(createRoundRunner).mock.calls.at(-1)![0];
      await opts.betweenRounds?.({ round: 1, packet: samplePacket });

      expect(dispatchOrchestratorPassMock).not.toHaveBeenCalled();
      // Falls back to deterministic directive
      expect(checkpointWriteMock).toHaveBeenCalledWith(
        expect.objectContaining({ orchestratorDirective: "pass directive" }),
      );
    });

    it("fails the run when an OrchestratorDispatchError escapes the round runner", async () => {
      const { OrchestratorDispatchError, runSwarm } =
        await import("../../../src/lib/run-swarm.js");
      runMock.mockImplementationOnce(async () => {
        throw new OrchestratorDispatchError(
          "Orchestrator dispatch failed: backend exited with code 1",
        );
      });

      const code = await runSwarm({
        config: baseConfig("orchestrator"),
        agents: baseAgents,
        backend: {} as BackendAdapter,
        ui: "silent",
        orchestratorAgent,
      });

      expect(code).toBe(1);
      expect(finalizeMock).toHaveBeenCalledWith(expect.any(String), "failed");
      expect(
        ledgerAppendEventMock.mock.calls.some(
          ([event]) => (event as { kind: string }).kind === "run:failed",
        ),
      ).toBe(true);
    });

    it("populates the packet's question resolutions from a successful orchestrator pass", async () => {
      runMock.mockResolvedValue({ rounds: [], ok: true, error: null });
      const resolution = {
        question: "Which DB?",
        status: "consensus" as const,
        answer: "Postgres",
        basis: "Most agents agreed",
        confidence: "high" as const,
        askedBy: ["alpha"],
        supportingAgents: ["alpha", "beta"],
        supportingReasoning: ["maturity", "ecosystem"],
        relatedObjections: [],
        relatedRisks: [],
        blockingScore: 5,
      };
      dispatchOrchestratorPassMock.mockResolvedValue({
        ok: true,
        output: {
          round: 2,
          directive: "llm-derived directive",
          questionResolutions: [resolution],
          questionResolutionLimit: 3,
          deferredQuestions: ["When will the team be ready?"],
          confidence: "high",
        },
        raw: null,
      });

      const { createRoundRunner } =
        await import("../../../src/lib/round-runner.js");
      const { runSwarm } = await import("../../../src/lib/run-swarm.js");

      await runSwarm({
        config: baseConfig("orchestrator"),
        agents: baseAgents,
        backend: {} as BackendAdapter,
        ui: "silent",
        orchestratorAgent,
      });

      const opts = vi.mocked(createRoundRunner).mock.calls.at(-1)![0];
      checkpointWriteMock.mockReset();
      const mutablePacket: RoundPacket = {
        round: 1,
        agents: ["alpha"],
        summaries: [],
        keyObjections: [],
        sharedRisks: [],
        openQuestions: ["Which DB?"],
        questionResolutions: [],
        questionResolutionLimit: 0,
        deferredQuestions: [],
      };
      await opts.betweenRounds?.({ round: 1, packet: mutablePacket });

      expect(mutablePacket.questionResolutions).toEqual([resolution]);
      expect(mutablePacket.questionResolutionLimit).toBe(3);
      expect(mutablePacket.deferredQuestions).toEqual([
        "When will the team be ready?",
      ]);
      expect(checkpointWriteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          priorPacket: expect.objectContaining({
            questionResolutions: [resolution],
            questionResolutionLimit: 3,
            deferredQuestions: ["When will the team be ready?"],
          }),
        }),
      );
    });

    it("does not mutate packet resolution fields when resolveMode is off", async () => {
      runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

      const { createRoundRunner } =
        await import("../../../src/lib/round-runner.js");
      const { runSwarm } = await import("../../../src/lib/run-swarm.js");

      await runSwarm({
        config: baseConfig("off"),
        agents: baseAgents,
        backend: {} as BackendAdapter,
        ui: "silent",
        orchestratorAgent,
      });

      const opts = vi.mocked(createRoundRunner).mock.calls.at(-1)![0];
      const mutablePacket: RoundPacket = {
        round: 1,
        agents: ["alpha"],
        summaries: [],
        keyObjections: [],
        sharedRisks: [],
        openQuestions: [],
        questionResolutions: [],
        questionResolutionLimit: 0,
        deferredQuestions: [],
      };
      const snapshot = JSON.parse(JSON.stringify(mutablePacket));
      await opts.betweenRounds?.({ round: 1, packet: mutablePacket });

      expect(mutablePacket).toEqual(snapshot);
    });

    it("appends a successful orchestrator pass to the checkpoint's orchestratorPasses", async () => {
      runMock.mockResolvedValue({ rounds: [], ok: true, error: null });
      const output = {
        round: 2,
        directive: "llm-derived directive",
        questionResolutions: [],
        questionResolutionLimit: 3,
        deferredQuestions: ["When can we ramp?"],
        confidence: "high" as const,
      };
      dispatchOrchestratorPassMock.mockResolvedValue({
        ok: true,
        output,
        raw: null,
      });

      const { createRoundRunner } =
        await import("../../../src/lib/round-runner.js");
      const { runSwarm } = await import("../../../src/lib/run-swarm.js");

      await runSwarm({
        config: baseConfig("orchestrator"),
        agents: baseAgents,
        backend: {} as BackendAdapter,
        ui: "silent",
        orchestratorAgent,
      });

      const opts = vi.mocked(createRoundRunner).mock.calls.at(-1)![0];
      checkpointWriteMock.mockReset();
      ledgerAppendEventMock.mockReset();
      await opts.betweenRounds?.({ round: 1, packet: samplePacket });

      const orchPassRecord = {
        round: 1,
        agentName: orchestratorAgent.name,
        output,
      };
      expect(checkpointWriteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orchestratorPasses: [expect.objectContaining(orchPassRecord)],
        }),
      );

      const orchEvent = ledgerAppendEventMock.mock.calls.find(
        ([event]) => (event as { kind: string }).kind === "orchestrator:pass",
      );
      expect(orchEvent).toBeDefined();
      expect(orchEvent![0].metadata).toEqual(
        expect.objectContaining({
          agentName: orchestratorAgent.name,
          directive: "llm-derived directive",
          confidence: "high",
          questionResolutionsCount: 0,
          questionResolutionLimit: 3,
          deferredQuestionsCount: 1,
        }),
      );
    });

    it("does not write orchestratorPasses on the checkpoint when resolveMode is off", async () => {
      runMock.mockResolvedValue({ rounds: [], ok: true, error: null });

      const { createRoundRunner } =
        await import("../../../src/lib/round-runner.js");
      const { runSwarm } = await import("../../../src/lib/run-swarm.js");

      await runSwarm({
        config: baseConfig("off"),
        agents: baseAgents,
        backend: {} as BackendAdapter,
        ui: "silent",
        orchestratorAgent,
      });

      const opts = vi.mocked(createRoundRunner).mock.calls.at(-1)![0];
      checkpointWriteMock.mockReset();
      await opts.betweenRounds?.({ round: 1, packet: samplePacket });

      const lastWrite = checkpointWriteMock.mock.calls.at(-1)![0] as {
        orchestratorPasses?: unknown;
      };
      expect(lastWrite.orchestratorPasses).toBeUndefined();
    });

    it("passes prior orchestrator resolutions into later orchestrator passes", async () => {
      runMock.mockResolvedValue({ rounds: [], ok: true, error: null });
      const resolution = {
        question: "Which DB?",
        status: "consensus" as const,
        answer: "Postgres",
        basis: "Most agents agreed",
        confidence: "high" as const,
        askedBy: ["alpha"],
        supportingAgents: ["alpha", "beta"],
        supportingReasoning: ["maturity", "ecosystem"],
        relatedObjections: [],
        relatedRisks: [],
        blockingScore: 5,
      };
      dispatchOrchestratorPassMock
        .mockResolvedValueOnce({
          ok: true,
          output: {
            round: 2,
            directive: "first directive",
            questionResolutions: [resolution],
            questionResolutionLimit: 2,
            deferredQuestions: ["Rollout cadence?"],
            confidence: "high",
          },
          raw: null,
        })
        .mockResolvedValueOnce({
          ok: true,
          output: {
            round: 3,
            directive: "second directive",
            questionResolutions: [],
            questionResolutionLimit: 2,
            deferredQuestions: [],
            confidence: "medium",
          },
          raw: null,
        });

      const { createRoundRunner } =
        await import("../../../src/lib/round-runner.js");
      const { runSwarm } = await import("../../../src/lib/run-swarm.js");

      await runSwarm({
        config: baseConfig("orchestrator"),
        agents: baseAgents,
        backend: {} as BackendAdapter,
        ui: "silent",
        orchestratorAgent,
      });

      const opts = vi.mocked(createRoundRunner).mock.calls.at(-1)![0];
      await opts.betweenRounds?.({ round: 1, packet: samplePacket });
      await opts.betweenRounds?.({
        round: 2,
        packet: { ...samplePacket, round: 2 },
      });

      expect(dispatchOrchestratorPassMock.mock.calls.at(-1)![0]).toEqual(
        expect.objectContaining({
          packet: expect.objectContaining({
            questionResolutions: [resolution],
            deferredQuestions: ["Rollout cadence?"],
            questionResolutionLimit: 2,
          }),
        }),
      );
    });

    it("checkpoints a completed round before failed orchestrator dispatch fails the run", async () => {
      writeRoundMock.mockResolvedValue(undefined);
      dispatchOrchestratorPassMock.mockResolvedValue({
        ok: false,
        error: "backend exited with code 1",
        raw: null,
      });
      const agentResults: AgentResult[] = [
        { agent: "alpha", ok: true, output: null, error: null, raw: null },
        { agent: "beta", ok: true, output: null, error: null, raw: null },
      ];
      runMock.mockImplementationOnce(async () => {
        const { createRoundRunner } =
          await import("../../../src/lib/round-runner.js");
        const opts = vi.mocked(createRoundRunner).mock.calls.at(-1)![0];
        emitterMock.emit("round:done", {
          round: 1,
          packet: samplePacket,
          agentResults,
        });
        await opts.betweenRounds?.({ round: 1, packet: samplePacket });
        return { rounds: [], ok: true, error: null };
      });

      const { runSwarm } = await import("../../../src/lib/run-swarm.js");

      const code = await runSwarm({
        config: baseConfig("orchestrator"),
        agents: baseAgents,
        backend: {} as BackendAdapter,
        ui: "silent",
        orchestratorAgent,
      });

      expect(code).toBe(1);
      expect(checkpointWriteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          lastCompletedRound: 1,
          priorPacket: samplePacket,
          completedRoundPackets: [samplePacket],
          completedRoundResults: [
            expect.objectContaining({ round: 1, packet: samplePacket }),
          ],
        }),
      );
      expect(finalizeMock).toHaveBeenCalledWith(expect.any(String), "failed");
    });

    it("throws an OrchestratorDispatchError out of betweenRounds when dispatch returns ok:false", async () => {
      runMock.mockResolvedValue({ rounds: [], ok: true, error: null });
      dispatchOrchestratorPassMock.mockResolvedValue({
        ok: false,
        error: "backend exited with code 1",
        raw: null,
      });

      const { createRoundRunner } =
        await import("../../../src/lib/round-runner.js");
      const { runSwarm } = await import("../../../src/lib/run-swarm.js");

      await runSwarm({
        config: baseConfig("orchestrator"),
        agents: baseAgents,
        backend: {} as BackendAdapter,
        ui: "silent",
        orchestratorAgent,
      });

      const opts = vi.mocked(createRoundRunner).mock.calls.at(-1)![0];
      await expect(
        opts.betweenRounds?.({ round: 1, packet: samplePacket }),
      ).rejects.toThrow(/orchestrator/i);
    });
  });
});
