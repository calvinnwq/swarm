import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "../../../src/schemas/index.js";
import type { BackendAdapter } from "../../../src/backends/index.js";
import type { SwarmRunConfig } from "../../../src/lib/config.js";

const destroyMock = vi.fn();
const initMock = vi.fn();
const finalizeMock = vi.fn();
const writeRoundMock = vi.fn();
const writeSynthesisMock = vi.fn();
const attachLiveRendererMock = vi.fn(() => ({ destroy: destroyMock }));
const attachQuietLoggerMock = vi.fn();
const runMock = vi.fn();

vi.mock("../../../src/lib/round-runner.js", () => ({
  createRoundRunner: vi.fn(() => ({
    emitter: new EventEmitter(),
    run: runMock,
  })),
}));

vi.mock("../../../src/lib/artifact-writer.js", () => ({
  ArtifactWriter: vi.fn(() => ({
    init: initMock,
    finalize: finalizeMock,
    writeRound: writeRoundMock,
    writeSynthesis: writeSynthesisMock,
  })),
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
  });

  it("destroys the live renderer when execution throws", async () => {
    const { runSwarm } = await import("../../../src/lib/run-swarm.js");
    const error = new Error("boom");
    runMock.mockRejectedValueOnce(error);

    const config: SwarmRunConfig = {
      topic: "topic",
      rounds: 1,
      preset: null,
      agents: ["product-manager", "principal-engineer"],
      selectionSource: "explicit-agents",
      resolveMode: "off",
      goal: null,
      decision: null,
      docs: [],
      commandText: "swarm run 1 topic --agents product-manager,principal-engineer",
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
});
