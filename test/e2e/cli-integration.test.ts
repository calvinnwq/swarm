/**
 * CLI integration tests with a controllable backend seam (NGX-103 / M5-01).
 *
 * These tests spawn the real built CLI binary and exercise the full command
 * path — argument parsing → config loading → agent resolution → backend
 * dispatch → artifact writing — without calling a live model. The backend
 * seam is a Node.js stub executable installed on PATH that returns
 * deterministic JSON matching AgentOutput schema, identical to the pattern
 * used in smoke.test.ts and codex-backend.test.ts.
 *
 * Coverage focus: explicit --agents flag path (no preset), which is not
 * exercised end-to-end by any existing test. The smoke/codex tests only
 * drive the preset path through the CLI; the programmatic e2e test drives
 * the agents path but bypasses the CLI binary entirely.
 */

import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../../dist/cli.mjs", import.meta.url));

function installStub(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, "claude");
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

if (process.argv[2] === "auth" && process.argv[3] === "status") {
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: "stub" }) + "\\n");
  process.exit(0);
}

const systemPromptFlag = process.argv.indexOf("--system-prompt");
const systemPrompt = systemPromptFlag >= 0 ? (process.argv[systemPromptFlag + 1] ?? "") : "";
const brief = fs.readFileSync(0, "utf8");
const statePath = path.join(path.dirname(process.argv[1]), ".stub-state.json");

let counters = {};
try { counters = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}

const agent = /product manager/i.test(systemPrompt)
  ? "product-manager"
  : /principal engineer/i.test(systemPrompt)
    ? "principal-engineer"
    : "unknown-agent";
const round = (counters[agent] ?? 0) + 1;
counters[agent] = round;
fs.writeFileSync(statePath, JSON.stringify(counters));

process.stdout.write(JSON.stringify({
  agent,
  round,
  stance: "Adopt",
  recommendation: agent + " recommends in round " + round,
  reasoning: [agent + " reasoning round " + round],
  objections: [],
  risks: ["shared risk"],
  changesFromPriorRound: round > 1 ? [agent + " updated in round " + round] : [],
  confidence: "high",
  openQuestions: brief.includes("Prior Round Packet") ? ["Sequencing?"] : [],
}));
`,
    "utf-8",
  );
  chmodSync(scriptPath, 0o755);
}

describe("e2e: CLI integration with --agents flag", () => {
  let baseDir: string;
  let binDir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    baseDir = join(tmpdir(), `swarm-cli-int-${randomUUID()}`);
    binDir = join(baseDir, "bin");
    installStub(binDir);
    originalPath = process.env.PATH;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    if (existsSync(baseDir)) rmSync(baseDir, { recursive: true, force: true });
  });

  it("runs 2 agents × 2 rounds via --agents flag and produces the full artifact tree", () => {
    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "2",
        "Should we adopt TypeScript everywhere",
        "--agents",
        "product-manager,principal-engineer",
        "--resolve",
        "orchestrator",
        "--goal",
        "Align on language strategy",
        "--decision",
        "Adopt / Defer / Reject",
      ],
      {
        cwd: baseDir,
        encoding: "utf-8",
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("[run] complete rounds=2");
    expect(result.stderr).not.toContain("swarm:");

    const runsDir = join(baseDir, ".swarm", "runs");
    const [entry] = readdirSync(runsDir);
    expect(entry).toBeTruthy();
    const runDir = join(runsDir, entry);

    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );
    expect(manifest.topic).toBe("Should we adopt TypeScript everywhere");
    expect(manifest.rounds).toBe(2);
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.goal).toBe("Align on language strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");
    expect(manifest.preset).toBeNull();
    expect(manifest.finishedAt).toBeDefined();

    expect(existsSync(join(runDir, "seed-brief.md"))).toBe(true);

    for (const round of ["round-01", "round-02"]) {
      const roundDir = join(runDir, round);
      expect(existsSync(join(roundDir, "brief.md"))).toBe(true);
      expect(existsSync(join(roundDir, "agents", "product-manager.md"))).toBe(
        true,
      );
      expect(
        existsSync(join(roundDir, "agents", "principal-engineer.md")),
      ).toBe(true);
    }

    const r1brief = readFileSync(join(runDir, "round-01", "brief.md"), "utf-8");
    expect(r1brief).toContain("Should we adopt TypeScript everywhere");
    const r2brief = readFileSync(join(runDir, "round-02", "brief.md"), "utf-8");
    expect(r2brief).toContain("Prior Round Packet");

    const r1pm = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    expect(r1pm).toContain("Agent: product-manager");
    expect(r1pm).toContain("Round: 1");
    expect(r1pm).toContain("Status: ok");

    const synthesis = JSON.parse(
      readFileSync(join(runDir, "synthesis.json"), "utf-8"),
    );
    expect(synthesis.topic).toBe("Should we adopt TypeScript everywhere");
    expect(synthesis.roundCount).toBe(2);
    expect(synthesis.agentCount).toBe(2);
    expect(synthesis.resolveMode).toBe("orchestrator");
    expect(synthesis.consensus).toBe(true);
    expect(synthesis.sharedRisks).toContain("shared risk");

    const synthesisMd = readFileSync(join(runDir, "synthesis.md"), "utf-8");
    expect(synthesisMd).toContain(
      "# Synthesis: Should we adopt TypeScript everywhere",
    );
    expect(synthesisMd).toContain("### Round 1");
    expect(synthesisMd).toContain("### Round 2");
  });

  it("runs 1 round with --resolve off via --agents flag and skips synthesis", () => {
    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "1",
        "Should we migrate to a monorepo",
        "--agents",
        "product-manager,principal-engineer",
        "--resolve",
        "off",
      ],
      {
        cwd: baseDir,
        encoding: "utf-8",
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("[run] complete rounds=1");

    const runsDir = join(baseDir, ".swarm", "runs");
    const [entry] = readdirSync(runsDir);
    const runDir = join(runsDir, entry);

    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );
    expect(manifest.rounds).toBe(1);
    expect(manifest.resolveMode).toBe("off");
    expect(manifest.preset).toBeNull();

    expect(existsSync(join(runDir, "round-01"))).toBe(true);
    expect(existsSync(join(runDir, "synthesis.json"))).toBe(true);
    const synthesis = JSON.parse(
      readFileSync(join(runDir, "synthesis.json"), "utf-8"),
    );
    expect(synthesis.resolveMode).toBe("off");
  });

  it("carries a --doc into the seed brief", () => {
    const docPath = join(baseDir, "context.md");
    writeFileSync(
      docPath,
      "# Context\n\nThis is carry-forward context.\n",
      "utf-8",
    );

    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "1",
        "Should we change our branching strategy",
        "--agents",
        "product-manager,principal-engineer",
        "--resolve",
        "off",
        "--doc",
        docPath,
      ],
      {
        cwd: baseDir,
        encoding: "utf-8",
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
      },
    );

    expect(result.status).toBe(0);

    const runsDir = join(baseDir, ".swarm", "runs");
    const [entry] = readdirSync(runsDir);
    const runDir = join(runsDir, entry);

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("context.md");
  });

  it("uses project-local agent overrides through the CLI", () => {
    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "agents", "product-manager.yml"),
      [
        "name: product-manager",
        "description: project-local PM override",
        "persona: You are the project PM with special context",
        "prompt: Evaluate from the project PM perspective",
        "backend: claude",
      ].join("\n"),
      "utf-8",
    );

    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "1",
        "Should we change our release cadence",
        "--agents",
        "product-manager,principal-engineer",
        "--resolve",
        "off",
      ],
      {
        cwd: baseDir,
        encoding: "utf-8",
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
      },
    );

    expect(result.status).toBe(0);

    const runsDir = join(baseDir, ".swarm", "runs");
    const [entry] = readdirSync(runsDir);
    const runDir = join(runsDir, entry);

    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );
    expect(manifest.agents).toContain("product-manager");

    const r1pm = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    expect(r1pm).toContain("Agent: product-manager");
    expect(r1pm).toContain("Status: ok");
  });

  it("reads agents from .swarm/config.yml when no --agents or --preset is given", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "resolve: off",
      ].join("\n"),
      "utf-8",
    );

    const result = spawnSync(
      "node",
      [cliPath, "run", "1", "Should we update our tooling"],
      {
        cwd: baseDir,
        encoding: "utf-8",
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("[run] complete rounds=1");

    const runsDir = join(baseDir, ".swarm", "runs");
    const [entry] = readdirSync(runsDir);
    const runDir = join(runsDir, entry);

    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.preset).toBeNull();
  });
});
