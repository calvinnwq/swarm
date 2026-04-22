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

  it("`swarm run 2 ... --preset product-decision` auto-selects quiet logs on non-TTY stderr and produces the golden-path artifacts", () => {
    const goal = "Decide on migration strategy";
    const decision = "Adopt / Defer / Reject";

    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "2",
        "Should we adopt server components?",
        "--preset",
        "product-decision",
        "--goal",
        goal,
        "--decision",
        decision,
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
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "[round 1] start agents=product-manager,principal-engineer",
    );
    expect(result.stderr).toContain("[round 1] product-manager dispatching");
    expect(result.stderr).not.toMatch(/\u001b\[/);
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
    expect(manifest.goal).toBe(goal);
    expect(manifest.decision).toBe(decision);
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

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    const roundOneBrief = readFileSync(
      join(runDir, "round-01", "brief.md"),
      "utf-8",
    );
    const roundTwoBrief = readFileSync(
      join(runDir, "round-02", "brief.md"),
      "utf-8",
    );

    expect(roundOneBrief).toBe(seedBrief);
    expect(roundTwoBrief).toContain("## Prior Round Packet");
    expect(roundTwoBrief).toContain('"agent": "product-manager"');
    expect(roundTwoBrief).toContain('"agent": "principal-engineer"');

    const synthesis = JSON.parse(
      readFileSync(join(runDir, "synthesis.json"), "utf-8"),
    );
    expect(synthesis.topic).toBe("Should we adopt server components?");
    expect(synthesis.roundCount).toBe(2);
    expect(synthesis.agentCount).toBe(2);
    expect(synthesis.resolveMode).toBe("orchestrator");
    expect(synthesis.consensus).toBe(true);

    const synthesisMd = readFileSync(join(runDir, "synthesis.md"), "utf-8");
    expect(synthesisMd).toContain(
      "# Synthesis: Should we adopt server components?",
    );
    expect(synthesisMd).toContain("### Round 1");
    expect(synthesisMd).toContain("### Round 2");
  });

  it("`swarm run --quiet` emits one-line event logs while still writing artifacts", () => {
    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "1",
        "Should we adopt server components?",
        "--preset",
        "product-decision",
        "--quiet",
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
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "[round 1] start agents=product-manager,principal-engineer",
    );
    expect(result.stderr).toContain("[round 1] product-manager dispatching");
    expect(result.stderr).toContain(
      "[round 1] product-manager ok stance=Adopt confidence=high",
    );
    expect(result.stderr).toContain("[round 1] done ok=2 fail=0");
    expect(result.stderr).toContain("[run] complete rounds=1");
    expect(result.stderr).not.toMatch(/\u001b\[/);

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);

    expect(existsSync(join(runDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(runDir, "synthesis.md"))).toBe(true);
  });

  it("CLI preset overrides config agents", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - product-manager",
        "  - staff-engineer",
        "resolve: off",
      ].join("\n"),
      "utf-8",
    );

    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "1",
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

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBe("product-decision");
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("off");
  });

  it("CLI flags override bundled preset defaults", () => {
    const goal = "Choose a phased rollout plan";
    const decision = "Ship now / Pilot first / Hold";

    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "1",
        "Should we adopt server components?",
        "--preset",
        "product-decision",
        "--resolve",
        "agents",
        "--goal",
        goal,
        "--decision",
        decision,
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

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBe("product-decision");
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe(goal);
    expect(manifest.decision).toBe(decision);

    const synthesis = JSON.parse(
      readFileSync(join(runDir, "synthesis.json"), "utf-8"),
    );
    expect(synthesis.resolveMode).toBe("agents");
  });

  it("repeated CLI --doc flags override config docs and land in the seed brief", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: product-decision",
        "docs:",
        "  - docs/from-config.md",
      ].join("\n"),
      "utf-8",
    );

    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "1",
        "Should we adopt server components?",
        "--doc",
        "docs/architecture.md",
        "--doc",
        "docs/decision-log.md",
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

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");

    expect(seedBrief).toContain(
      "Carry-forward docs: docs/architecture.md, docs/decision-log.md",
    );
    expect(seedBrief).toContain("- docs/architecture.md");
    expect(seedBrief).toContain("- docs/decision-log.md");
    expect(seedBrief).not.toContain("docs/from-config.md");
  });

  it("config presets do not leak into explicit-agent runs", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "preset: missing-preset",
      ].join("\n"),
      "utf-8",
    );

    const result = spawnSync(
      "node",
      [cliPath, "run", "1", "Should we adopt server components?"],
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

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
  });

  it("project config can drive the golden path without repeating preset intent on the CLI", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: product-decision",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "docs:",
        "  - docs/architecture.md",
      ].join("\n"),
      "utf-8",
    );

    const result = spawnSync(
      "node",
      [cliPath, "run", "1", "Should we adopt server components?"],
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

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBe("product-decision");
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Preset: product-decision");
    expect(seedBrief).toContain("Goal: Decide on migration strategy");
    expect(seedBrief).toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).toContain("Carry-forward docs: docs/architecture.md");
  });
});
