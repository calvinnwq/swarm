import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type {
  AgentDefinition,
  AgentOutput,
  MessageEnvelope,
  RoundPacket,
  RunEvent,
} from "../../src/schemas/index.js";
import type { BackendAdapter, AgentResponse } from "../../src/backends/index.js";
import type { SwarmRunConfig } from "../../src/lib/config.js";
import { runSwarm, resumeSwarm } from "../../src/lib/run-swarm.js";
import { buildRunDirName } from "../../src/lib/artifact-writer.js";
import { LedgerWriter } from "../../src/lib/ledger-writer.js";
import { CheckpointWriter } from "../../src/lib/checkpoint-writer.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAgentDef(name: string): AgentDefinition {
  return {
    name,
    description: `${name} agent`,
    persona: `You are the ${name}`,
    prompt: `Analyze the topic as ${name}`,
    backend: "claude",
  };
}

function makeAgentOutput(
  agent: string,
  round: number,
  overrides: Partial<AgentOutput> = {},
): AgentOutput {
  return {
    agent,
    round,
    stance: `${agent}-stance-r${round}`,
    recommendation: `${agent} recommends action for round ${round}`,
    reasoning: [`${agent} reason 1`, `${agent} reason 2`],
    objections: [`${agent} objection`],
    risks: ["shared risk alpha", `${agent}-specific risk`],
    changesFromPriorRound:
      round > 1 ? [`${agent} updated stance in round ${round}`] : [],
    confidence: "high",
    openQuestions: [`${agent} open question`],
    ...overrides,
  };
}

function makeRoundPacket(round: number, agentNames: string[]): RoundPacket {
  return {
    round,
    agents: agentNames,
    summaries: agentNames.map((name) => ({
      agent: name,
      stance: `${name}-stance-r${round}`,
      recommendation: `${name} recommends action for round ${round}`,
      objections: [`${name} objection`],
      risks: ["shared risk alpha"],
      confidence: "high",
      openQuestions: [`${name} open question`],
    })),
    keyObjections: agentNames.map((n) => `${n} objection`),
    sharedRisks: ["shared risk alpha"],
    openQuestions: agentNames.map((n) => `${n} open question`),
    questionResolutions: [],
    questionResolutionLimit: 0,
    deferredQuestions: [],
  };
}

// ---------------------------------------------------------------------------
// Mock backend
// ---------------------------------------------------------------------------

class MockBackendAdapter implements BackendAdapter {
  private roundCounter = new Map<string, number>();

  constructor(private outputs: Map<string, AgentOutput[]>) {}

  async dispatch(
    _prompt: string,
    agent: AgentDefinition,
  ): Promise<AgentResponse> {
    const roundIdx = this.roundCounter.get(agent.name) ?? 0;
    this.roundCounter.set(agent.name, roundIdx + 1);

    const agentOutputs = this.outputs.get(agent.name);
    if (!agentOutputs || !agentOutputs[roundIdx]) {
      return {
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "No canned output for this round",
        timedOut: false,
        durationMs: 100,
      };
    }

    return {
      ok: true,
      exitCode: 0,
      stdout: JSON.stringify(agentOutputs[roundIdx]),
      stderr: "",
      timedOut: false,
      durationMs: 100,
    };
  }
}

// ---------------------------------------------------------------------------
// Shared test config
// ---------------------------------------------------------------------------

const agents: AgentDefinition[] = [makeAgentDef("alpha"), makeAgentDef("beta")];

const config: SwarmRunConfig = {
  topic: "Test durable orchestration",
  rounds: 2,
  backend: "claude",
  preset: null,
  agents: ["alpha", "beta"],
  selectionSource: "explicit-agents",
  resolveMode: "orchestrator",
  goal: "Test the durable pipeline",
  decision: "Validate checkpoints and ledgers",
  docs: [],
  commandText:
    'swarm run 2 "Test durable orchestration" --agents alpha,beta --resolve orchestrator',
};

const startedAt = new Date("2026-01-15T10:30:00.000Z");

function buildTwoRoundBackend(): MockBackendAdapter {
  const outputs = new Map<string, AgentOutput[]>();
  outputs.set("alpha", [
    makeAgentOutput("alpha", 1),
    makeAgentOutput("alpha", 2),
  ]);
  outputs.set("beta", [
    makeAgentOutput("beta", 1),
    makeAgentOutput("beta", 2),
  ]);
  return new MockBackendAdapter(outputs);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("e2e: durable outer-loop orchestration", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = join(tmpdir(), `swarm-durable-e2e-${randomUUID()}`);
  });

  afterEach(() => {
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  function deriveRunDir(): string {
    return join(baseDir, buildRunDirName(startedAt, config.topic));
  }

  it("writes checkpoint.json after every round with correct metadata", async () => {
    const backend = buildTwoRoundBackend();
    await runSwarm({ config, agents, backend, baseDir, startedAt, ui: "silent" });

    const runDir = deriveRunDir();
    expect(existsSync(join(runDir, "checkpoint.json"))).toBe(true);

    const checkpoint = JSON.parse(
      readFileSync(join(runDir, "checkpoint.json"), "utf-8"),
    );

    expect(checkpoint.lastCompletedRound).toBe(2);
    expect(checkpoint.runId).toBeDefined();
    expect(checkpoint.checkpointedAt).toBeDefined();
    expect(checkpoint.priorPacket).toBeDefined();
    expect(checkpoint.priorPacket.round).toBe(2);
    expect(checkpoint.priorPacket.summaries).toHaveLength(2);
  });

  it("emits a complete, ordered lifecycle event sequence in events.jsonl", async () => {
    const backend = buildTwoRoundBackend();
    await runSwarm({ config, agents, backend, baseDir, startedAt, ui: "silent" });

    const runDir = deriveRunDir();
    const raw = readFileSync(join(runDir, "events.jsonl"), "utf-8");
    const events: RunEvent[] = raw
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as RunEvent);
    const kinds = events.map((e) => e.kind);

    // Boundary events
    expect(kinds[0]).toBe("run:started");
    expect(kinds[kinds.length - 1]).toBe("run:completed");

    // All lifecycle kinds are present
    for (const expected of [
      "scheduler:decision",
      "round:started",
      "agent:started",
      "agent:completed",
      "round:completed",
      "orchestrator:pass",
    ]) {
      expect(kinds).toContain(expected);
    }

    // round:completed for round 1 precedes orchestrator:pass
    const r1completedIdx = events.findIndex(
      (e) => e.kind === "round:completed" && e.roundNumber === 1,
    );
    const passIdx = kinds.indexOf("orchestrator:pass");
    expect(r1completedIdx).toBeLessThan(passIdx);
    expect(r1completedIdx).toBeGreaterThan(-1);

    // run:started precedes first round:started
    expect(kinds.indexOf("run:started")).toBeLessThan(
      kinds.indexOf("round:started"),
    );

    // Both rounds have events stamped with their roundNumber
    const round1Events = events.filter((e) => e.roundNumber === 1);
    const round2Events = events.filter((e) => e.roundNumber === 2);
    expect(round1Events.length).toBeGreaterThan(0);
    expect(round2Events.length).toBeGreaterThan(0);

    // Each agent has started/completed events in round 1
    const r1AgentStarted = events.filter(
      (e) => e.kind === "agent:started" && e.roundNumber === 1,
    );
    expect(r1AgentStarted.length).toBe(2);

    // All events carry a runId
    for (const e of events) {
      expect(e.runId).toBeDefined();
      expect(typeof e.runId).toBe("string");
    }
  });

  it("records staged then committed delivery for each agent in messages.jsonl", async () => {
    const singleRoundConfig: SwarmRunConfig = { ...config, rounds: 1 };
    const outputs = new Map<string, AgentOutput[]>();
    outputs.set("alpha", [makeAgentOutput("alpha", 1)]);
    outputs.set("beta", [makeAgentOutput("beta", 1)]);
    const backend = new MockBackendAdapter(outputs);

    await runSwarm({
      config: singleRoundConfig,
      agents,
      backend,
      baseDir,
      startedAt,
      ui: "silent",
    });

    const runDir = join(baseDir, buildRunDirName(startedAt, singleRoundConfig.topic));
    const raw = readFileSync(join(runDir, "messages.jsonl"), "utf-8");
    const messages: MessageEnvelope[] = raw
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as MessageEnvelope);

    for (const agentName of ["alpha", "beta"]) {
      const stagedForAgent = messages.filter(
        (m) =>
          m.recipients.includes(agentName) && m.deliveryStatus === "staged",
      );
      const committedForAgent = messages.filter(
        (m) =>
          m.recipients.includes(agentName) && m.deliveryStatus === "committed",
      );

      expect(stagedForAgent.length).toBeGreaterThan(0);
      expect(committedForAgent.length).toBeGreaterThan(0);

      // staged record appears before committed record for the same messageId
      const msgId = stagedForAgent[0].messageId;
      const stagedIdx = messages.findIndex(
        (m) => m.messageId === msgId && m.deliveryStatus === "staged",
      );
      const committedIdx = messages.findIndex(
        (m) => m.messageId === msgId && m.deliveryStatus === "committed",
      );
      expect(stagedIdx).toBeGreaterThan(-1);
      expect(committedIdx).toBeGreaterThan(-1);
      expect(stagedIdx).toBeLessThan(committedIdx);
    }

    // All messages have required fields
    for (const m of messages) {
      expect(m.messageId).toBeDefined();
      expect(m.senderId).toBe("orchestrator");
      expect(m.createdAt).toBeDefined();
    }
  });

  it("resumeSwarm continues from a checkpoint and completes the remaining rounds", async () => {
    // Set up a partial run directory that simulates a crash after round 1.
    // We create the directory structure directly using the same infrastructure
    // that runSwarm would use.
    const runDir = deriveRunDir();
    mkdirSync(runDir, { recursive: true });

    const runId = randomUUID();

    // Write a minimal manifest
    const manifest = {
      runId,
      status: "running",
      topic: config.topic,
      rounds: config.rounds,
      backend: config.backend,
      preset: config.preset,
      goal: config.goal,
      decision: config.decision,
      agents: config.agents,
      resolveMode: config.resolveMode,
      startedAt: startedAt.toISOString(),
      runDir,
    };
    writeFileSync(
      join(runDir, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    writeFileSync(join(runDir, "seed-brief.md"), "# Seed brief\n");

    // Write a round-01 brief to simulate the artifact that would have been written
    mkdirSync(join(runDir, "round-01", "agents"), { recursive: true });
    writeFileSync(join(runDir, "round-01", "brief.md"), "# Round 1 brief\n");

    // Initialise the ledger (creates empty messages.jsonl and events.jsonl)
    const ledger = new LedgerWriter(runDir);
    ledger.init();

    // Write a checkpoint as if round 1 just completed
    const priorPacket = makeRoundPacket(1, ["alpha", "beta"]);
    const checkpointWriter = new CheckpointWriter(runDir);
    checkpointWriter.write({
      runId,
      lastCompletedRound: 1,
      priorPacket,
      checkpointedAt: new Date().toISOString(),
    });

    // No synthesis.json yet (run was interrupted before completion)
    expect(existsSync(join(runDir, "synthesis.json"))).toBe(false);

    // Resume: backend only has round 2 outputs (idx 0 = the first dispatch call)
    const resumeOutputs = new Map<string, AgentOutput[]>();
    resumeOutputs.set("alpha", [makeAgentOutput("alpha", 2)]);
    resumeOutputs.set("beta", [makeAgentOutput("beta", 2)]);
    const resumeBackend = new MockBackendAdapter(resumeOutputs);

    const exitCode = await resumeSwarm({
      config,
      agents,
      backend: resumeBackend,
      runDir,
      ui: "silent",
    });

    expect(exitCode).toBe(0);

    // synthesis.json must now exist (run completed)
    expect(existsSync(join(runDir, "synthesis.json"))).toBe(true);
    const synthesis = JSON.parse(
      readFileSync(join(runDir, "synthesis.json"), "utf-8"),
    );
    expect(synthesis.topic).toBe(config.topic);

    // events.jsonl must contain a run:resumed event
    const eventsRaw = readFileSync(join(runDir, "events.jsonl"), "utf-8");
    const eventKinds = eventsRaw
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).kind as string);
    expect(eventKinds).toContain("run:resumed");
    expect(eventKinds).toContain("run:completed");

    // checkpoint must be updated to reflect the newly completed round 2
    const finalCheckpoint = JSON.parse(
      readFileSync(join(runDir, "checkpoint.json"), "utf-8"),
    );
    expect(finalCheckpoint.lastCompletedRound).toBe(2);
    expect(finalCheckpoint.runId).toBe(runId);

    // round-02 artifacts must be present
    expect(existsSync(join(runDir, "round-02", "brief.md"))).toBe(true);
    expect(existsSync(join(runDir, "round-02", "agents", "alpha.md"))).toBe(
      true,
    );
    expect(existsSync(join(runDir, "round-02", "agents", "beta.md"))).toBe(
      true,
    );
  });
});
