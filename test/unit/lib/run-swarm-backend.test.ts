import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "../../../src/schemas/index.js";
import type { BackendAdapter } from "../../../src/backends/index.js";
import type { SwarmRunConfig } from "../../../src/lib/config.js";
import type { BackendAdapterResolver } from "../../../src/lib/round-runner.js";

const artifactWriterArgs: unknown[] = [];
const createRoundRunnerArgs: unknown[] = [];
const runMock = vi.fn();
const emitterMock = new EventEmitter();

vi.mock("../../../src/lib/round-runner.js", () => ({
  createRoundRunner: vi.fn((args: unknown) => {
    createRoundRunnerArgs.push(args);
    return {
      emitter: emitterMock,
      run: runMock,
    };
  }),
}));

vi.mock("../../../src/lib/artifact-writer.js", () => ({
  ArtifactWriter: vi.fn(function ArtifactWriter(args) {
    artifactWriterArgs.push(args);
    return {
      init: vi.fn(),
      finalize: vi.fn(),
      writeRound: vi.fn(),
      writeSynthesis: vi.fn(),
    };
  }),
  buildRunDirName: vi.fn(() => "run-dir"),
}));

vi.mock("../../../src/lib/synthesis.js", () => ({
  buildOrchestratorSynthesis: vi.fn(() => ({ summary: "ok" })),
}));

vi.mock("../../../src/lib/brief-generator.js", () => ({
  buildSeedBrief: vi.fn(() => "seed brief"),
  buildRoundBrief: vi.fn(() => "round brief"),
}));

vi.mock("../../../src/ui/index.js", () => ({
  attachLiveRenderer: vi.fn(() => ({ destroy: vi.fn() })),
  attachQuietLogger: vi.fn(),
}));

describe("runSwarm backend manifest", () => {
  beforeEach(() => {
    artifactWriterArgs.length = 0;
    createRoundRunnerArgs.length = 0;
    runMock.mockReset();
    emitterMock.removeAllListeners();
  });

  it("persists the resolved backend in the run manifest", async () => {
    const { runSwarm } = await import("../../../src/lib/run-swarm.js");
    runMock.mockResolvedValueOnce({ rounds: [], ok: true, error: null });

    const config: SwarmRunConfig = {
      topic: "topic",
      rounds: 1,
      backend: "claude",
      preset: null,
      agents: ["product-manager", "principal-engineer"],
      selectionSource: "explicit-agents",
      resolveMode: "off",
      goal: null,
      decision: null,
      docs: [],
      commandText:
        "swarm run 1 topic --agents product-manager,principal-engineer --backend claude",
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

    expect(artifactWriterArgs[0]).toMatchObject({
      manifest: expect.objectContaining({ backend: "claude" }),
    });
  });

  it("forwards a per-agent resolveBackend through to createRoundRunner", async () => {
    const { runSwarm } = await import("../../../src/lib/run-swarm.js");
    runMock.mockResolvedValueOnce({ rounds: [], ok: true, error: null });

    const config: SwarmRunConfig = {
      topic: "topic",
      rounds: 1,
      backend: "claude",
      preset: null,
      agents: ["alpha"],
      selectionSource: "explicit-agents",
      resolveMode: "off",
      goal: null,
      decision: null,
      docs: [],
      commandText: "swarm run 1 topic --agents alpha",
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
    const perAgentAdapter = {} as BackendAdapter;
    const resolveBackend: BackendAdapterResolver = () => perAgentAdapter;

    await expect(
      runSwarm({ config, agents, backend, ui: "silent", resolveBackend }),
    ).resolves.toBe(0);

    expect(createRoundRunnerArgs).toHaveLength(1);
    expect(createRoundRunnerArgs[0]).toMatchObject({ resolveBackend });
  });
});
