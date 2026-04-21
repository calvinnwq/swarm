/**
 * Smoke verification for the README golden path (NGX-95 / M1-07).
 *
 * The alpha contract documented in README.md is:
 *   1. `swarm doctor` reports ready on a fresh checkout
 *   2. `swarm run 2 "<topic>" --preset product-decision` resolves the bundled
 *      preset + bundled agents and produces the full artifact tree
 *
 * This file exercises both halves end-to-end through the built CLI so we
 * catch packaging regressions in bundled asset resolution and command wiring.
 * The only stand-in is the external `claude` binary, replaced here with a
 * fixture executable on PATH.
 */
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../../dist/cli.mjs", import.meta.url));

function installClaudeStub(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, "claude");
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const systemPromptFlag = process.argv.indexOf("--system-prompt");
const systemPrompt = systemPromptFlag >= 0 ? (process.argv[systemPromptFlag + 1] ?? "") : "";
const brief = fs.readFileSync(0, "utf8");
const statePath = path.join(path.dirname(process.argv[1]), ".claude-state.json");

let counters = {};
try {
  counters = JSON.parse(fs.readFileSync(statePath, "utf8"));
} catch {}

const agent = /product manager/i.test(systemPrompt)
  ? "product-manager"
  : /principal engineer/i.test(systemPrompt)
    ? "principal-engineer"
    : "unknown-agent";
const round = (counters[agent] ?? 0) + 1;
counters[agent] = round;
fs.writeFileSync(statePath, JSON.stringify(counters));

process.stdout.write(
  JSON.stringify({
    agent,
    round,
    stance: "Adopt",
    recommendation: agent + " recommends Adopt in round " + round,
    reasoning: [agent + " reasoning for round " + round],
    objections: [],
    risks: ["shared migration risk"],
    changesFromPriorRound:
      round > 1 ? [agent + " refined stance in round " + round] : [],
    confidence: "high",
    openQuestions: brief.includes("Prior Round Packet")
      ? ["Confirm execution sequencing"]
      : [],
  }),
);
`,
    "utf-8",
  );
  chmodSync(scriptPath, 0o755);
}

describe("smoke: README golden path", () => {
  let baseDir: string;
  let binDir: string;

  beforeEach(() => {
    baseDir = join(tmpdir(), `swarm-smoke-${randomUUID()}`);
    binDir = join(baseDir, "bin");
    installClaudeStub(binDir);
  });

  afterEach(() => {
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("`swarm doctor` reports ready against the built CLI", () => {
    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("swarm doctor: ready");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stderr).toBe("");
  });

  it("`swarm run 2 ... --preset product-decision` resolves bundled assets and produces the golden-path artifacts", () => {
    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "2",
        "Should we adopt server components?",
        "--preset",
        "product-decision",
      ],
      {
        cwd: baseDir,
        encoding: "utf-8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("[round 1] start");
    expect(result.stderr).toContain("[run] complete");

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDirEntries = readdirSync(runsDir);
    expect(runDirEntries).toHaveLength(1);

    const runDir = join(runsDir, runDirEntries[0]);
    expect(existsSync(runDir)).toBe(true);

    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );
    expect(manifest.topic).toBe("Should we adopt server components?");
    expect(manifest.rounds).toBe(2);
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.finishedAt).toBeDefined();

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
