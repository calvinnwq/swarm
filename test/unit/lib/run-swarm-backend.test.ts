import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  let tempDirs: string[] = [];

  beforeEach(() => {
    artifactWriterArgs.length = 0;
    createRoundRunnerArgs.length = 0;
    runMock.mockReset();
    emitterMock.removeAllListeners();
    tempDirs = [];
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
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

  it("passes materialized carry-forward doc snapshots to the artifact writer", async () => {
    const { runSwarm } = await import("../../../src/lib/run-swarm.js");
    runMock.mockResolvedValueOnce({ rounds: [], ok: true, error: null });

    const tempDir = await mkdtemp(join(tmpdir(), "swarm-run-docs-"));
    tempDirs.push(tempDir);
    const docPath = join(tempDir, "context.md");
    await writeFile(docPath, "alpha beta gamma", "utf-8");

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
      docs: [docPath],
      commandText:
        "swarm run 1 topic --agents product-manager,principal-engineer --doc context.md",
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
      carryForwardDocPackets: [
        expect.objectContaining({
          path: docPath,
          content: "alpha beta gamma",
          originalCharCount: 16,
          includedCharCount: 16,
          truncated: false,
          provenance: expect.objectContaining({
            absolutePath: docPath,
            excerptStart: 0,
            excerptEnd: 16,
            sha256:
              "64989ccbf3efa9c84e2afe7cee9bc5828bf0fcb91e44f8c1e591638a2c2e90e3",
            mtimeMs: expect.any(Number),
          }),
        }),
      ],
    });
    expect(createRoundRunnerArgs[0]).toMatchObject({
      carryForwardDocPackets: [
        expect.objectContaining({
          path: docPath,
          content: "alpha beta gamma",
          provenance: expect.objectContaining({
            absolutePath: docPath,
          }),
        }),
      ],
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
