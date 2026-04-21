/**
 * Smoke verification for the README golden path (NGX-95 / M1-07).
 *
 * The alpha contract documented in README.md is:
 *   1. `swarm doctor` reports ready on a fresh checkout
 *   2. `swarm run 2 "<topic>" --preset product-decision` resolves the bundled
 *      preset + bundled agents and produces the full artifact tree
 *
 * This file exercises both halves end-to-end. The doctor check spawns the
 * built CLI so we catch packaging regressions (bundled-dir resolution, CLI
 * wiring). The run check uses the programmatic API with a mock backend —
 * the only stand-in is the claude CLI boundary itself, everything else
 * (preset registry, agent registry, brief generation, round runner,
 * synthesis, artifact writer) runs exactly as the CLI would.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import type {
  BackendAdapter,
  AgentResponse,
} from "../../src/backends/index.js";
import {
  buildConfig,
  loadAgentRegistry,
  loadPresetRegistry,
  runSwarm,
} from "../../src/lib/index.js";
import type { AgentDefinition, AgentOutput } from "../../src/schemas/index.js";

const cliPath = fileURLToPath(new URL("../../dist/cli.mjs", import.meta.url));

function makeAgentOutput(
  agent: string,
  round: number,
  stance: string,
): AgentOutput {
  return {
    agent,
    round,
    stance,
    recommendation: `${agent} recommends ${stance} in round ${round}`,
    reasoning: [`${agent} reasoning for round ${round}`],
    objections: [],
    risks: ["shared migration risk"],
    changesFromPriorRound:
      round > 1 ? [`${agent} refined stance in round ${round}`] : [],
    confidence: "high",
    openQuestions: [],
  };
}

/**
 * Stand-in for the claude CLI backend. Returns a valid AgentOutput JSON
 * keyed by agent name, incrementing the round counter per call so the
 * second invocation of an agent returns its round-2 output.
 */
class SmokeBackend implements BackendAdapter {
  private readonly counters = new Map<string, number>();

  async dispatch(
    _prompt: string,
    agent: AgentDefinition,
  ): Promise<AgentResponse> {
    const roundIdx = this.counters.get(agent.name) ?? 0;
    this.counters.set(agent.name, roundIdx + 1);
    const output = makeAgentOutput(agent.name, roundIdx + 1, "Adopt");
    return {
      ok: true,
      exitCode: 0,
      stdout: JSON.stringify(output),
      stderr: "",
      timedOut: false,
      durationMs: 10,
    };
  }
}

describe("smoke: README golden path", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = join(tmpdir(), `swarm-smoke-${randomUUID()}`);
  });

  afterEach(() => {
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("`swarm doctor` reports ready against the built CLI", () => {
    const result = spawnSync("node", [cliPath, "doctor"], {
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("swarm doctor: ready");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stderr).toBe("");
  });

  it("`swarm run 2 ... --preset product-decision` resolves bundled assets and produces the golden-path artifacts", async () => {
    // Mirror the CLI flow exactly (minus the claude backend): resolve the
    // bundled `product-decision` preset, then load the two bundled agents
    // it names via the real agent registry.
    const presetRegistry = await loadPresetRegistry();
    const preset = presetRegistry.getPreset("product-decision");
    expect(preset.agents).toEqual(["product-manager", "principal-engineer"]);

    const agentRegistry = await loadAgentRegistry();
    const agents = preset.agents.map((name) => agentRegistry.getAgent(name));
    expect(agents.map((a) => a.name)).toEqual([
      "product-manager",
      "principal-engineer",
    ]);

    const config = buildConfig({
      rounds: 2,
      topic: ["Should", "we", "adopt", "server", "components?"],
      agents: preset.agents.join(","),
      resolve: preset.resolve,
      goal: "Decide on migration strategy",
      decision: "Adopt / Defer / Reject",
      docs: [],
      preset: preset.name,
      selectionSource: "preset",
      commandText:
        'run 2 "Should we adopt server components?" --preset product-decision',
    });

    const exitCode = await runSwarm({
      config,
      agents,
      backend: new SmokeBackend(),
      baseDir,
      startedAt: new Date("2026-04-21T09:00:00.000Z"),
      ui: "silent",
    });

    expect(exitCode).toBe(0);

    const runDir = join(
      baseDir,
      "20260421-090000-should-we-adopt-server-components",
    );
    expect(existsSync(runDir)).toBe(true);

    // manifest.json records the golden-path shape (preset + bundled agents)
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );
    expect(manifest.topic).toBe("Should we adopt server components?");
    expect(manifest.rounds).toBe(2);
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.finishedAt).toBeDefined();

    // Full artifact tree documented in README's "Artifact layout" section
    expect(existsSync(join(runDir, "seed-brief.md"))).toBe(true);
    for (const round of ["round-01", "round-02"]) {
      expect(existsSync(join(runDir, round, "brief.md"))).toBe(true);
      expect(
        existsSync(join(runDir, round, "agents", "product-manager.md")),
      ).toBe(true);
      expect(
        existsSync(join(runDir, round, "agents", "principal-engineer.md")),
      ).toBe(true);
    }

    // synthesis.json + synthesis.md exist, and synthesis reports consensus
    // (all agents returned the same stance across both rounds)
    const synthesis = JSON.parse(
      readFileSync(join(runDir, "synthesis.json"), "utf-8"),
    );
    expect(synthesis.topic).toBe("Should we adopt server components?");
    expect(synthesis.roundCount).toBe(2);
    expect(synthesis.agentCount).toBe(2);
    expect(synthesis.consensus).toBe(true);

    const synthesisMd = readFileSync(join(runDir, "synthesis.md"), "utf-8");
    expect(synthesisMd).toContain(
      "# Synthesis: Should we adopt server components?",
    );
    expect(synthesisMd).toContain("### Round 1");
    expect(synthesisMd).toContain("### Round 2");
  });
});
