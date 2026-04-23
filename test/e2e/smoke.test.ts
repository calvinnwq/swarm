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

if (process.argv[2] === "auth" && process.argv[3] === "status") {
  process.stdout.write(
    JSON.stringify({
      loggedIn: true,
      authMethod: "test-stub",
    }) + "\\n",
  );
  process.exit(0);
}

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
const usesProjectOverride =
  agent === "product-manager" &&
  systemPrompt.includes("PROJECT_AGENT_OVERRIDE_MARKER");
const usesGlobalOverride =
  agent === "product-manager" &&
  systemPrompt.includes("GLOBAL_AGENT_OVERRIDE_MARKER");
const round = (counters[agent] ?? 0) + 1;
counters[agent] = round;
fs.writeFileSync(statePath, JSON.stringify(counters));

process.stdout.write(
  JSON.stringify({
    agent,
    round,
    stance: "Adopt",
    recommendation: usesProjectOverride
      ? "project-local product-manager override active in round " + round
      : usesGlobalOverride
        ? "global product-manager override active in round " + round
      : agent + " recommends Adopt in round " + round,
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
  let originalPath: string | undefined;

  beforeEach(() => {
    baseDir = join(tmpdir(), `swarm-smoke-${randomUUID()}`);
    binDir = join(baseDir, "bin");
    installClaudeStub(binDir);
    originalPath = process.env.PATH;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
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
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("no .swarm/config.yml (CLI flags only)");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).not.toContain("backend capability");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports ready when project config references a valid preset", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "preset: product-decision\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("swarm doctor: ready");
    expect(result.stdout).toContain("[OK] config preset");
    expect(result.stdout).toContain(
      'preset "product-decision" resolves (2 agent(s))',
    );
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).toContain("[OK] backend capability");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports actionable problems when project config references an unknown preset", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "preset: missing-preset\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[FAIL] config preset");
    expect(result.stdout).toContain('unknown preset "missing-preset"');
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).toContain("[OK] backend capability");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports actionable problems when project config is invalid", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "rounds: 9\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[FAIL] project config");
    expect(result.stdout).toContain("invalid .swarm/config.yml");
    expect(result.stdout).toContain("rounds");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).not.toContain("backend capability");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports both project-config and global agent-registry failures together", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "rounds: 9\n",
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[FAIL] project config");
    expect(result.stdout).toContain("invalid .swarm/config.yml");
    expect(result.stdout).toContain("rounds");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports both project-config and global preset-registry failures together", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "rounds: 9\n",
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[FAIL] project config");
    expect(result.stdout).toContain("invalid .swarm/config.yml");
    expect(result.stdout).toContain("rounds");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports invalid project config alongside both global registry failures", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "rounds: 9\n",
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[FAIL] project config");
    expect(result.stdout).toContain("invalid .swarm/config.yml");
    expect(result.stdout).toContain("rounds");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports actionable problems when project config preset references an unknown agent", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "preset: project-decision\n",
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "project-decision.yml"),
      [
        "name: project-decision",
        "agents:",
        "  - product-manager",
        "  - ghost-agent",
        "resolve: orchestrator",
      ].join("\n"),
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[FAIL] config preset");
    expect(result.stdout).toContain(
      'preset "project-decision" references unknown agent(s): ghost-agent',
    );
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports actionable problems when project config references an unknown agent", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      ["agents:", "  - product-manager", "  - ghost-agent"].join("\n"),
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[FAIL] config agents");
    expect(result.stdout).toContain(
      "unknown agent(s) referenced in config: ghost-agent",
    );
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` prioritizes explicit config agents even when they fail", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - product-manager",
        "  - ghost-agent",
        "preset: project-decision",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "project-decision.yml"),
      [
        "name: project-decision",
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[FAIL] config agents");
    expect(result.stdout).toContain(
      "unknown agent(s) referenced in config: ghost-agent",
    );
    expect(result.stdout).not.toContain("config preset");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` skips preset validation when explicit project config agents are valid", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "preset: project-decision",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "project-decision.yml"),
      [
        "name: project-decision",
        "agents:",
        "  - ghost-agent",
        "  - another-ghost-agent",
        "resolve: orchestrator",
      ].join("\n"),
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("swarm doctor: ready");
    expect(result.stdout).toContain("[OK] config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports ready when project config references valid explicit agents", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      ["agents:", "  - product-manager", "  - principal-engineer"].join("\n"),
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("swarm doctor: ready");
    expect(result.stdout).toContain("[OK] config agents");
    expect(result.stdout).toContain("all 2 config agent(s) resolve");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports ready when project config is present but empty", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(join(baseDir, ".swarm", "config.yml"), "", "utf-8");

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("swarm doctor: ready");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports a project-local agent-registry failure even when project config is present but empty", () => {
    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(join(baseDir, ".swarm", "config.yml"), "", "utf-8");
    writeFileSync(
      join(baseDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports a project-local preset-registry failure even when project config is present but empty", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(join(baseDir, ".swarm", "config.yml"), "", "utf-8");
    writeFileSync(
      join(baseDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports both project-local registry failures even when project config is present but empty", () => {
    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(join(baseDir, ".swarm", "config.yml"), "", "utf-8");
    writeFileSync(
      join(baseDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports a global agent-registry failure even when project config is present but empty", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(join(baseDir, ".swarm", "config.yml"), "", "utf-8");
    writeFileSync(
      join(homeDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports a global preset-registry failure even when project config is present but empty", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(join(baseDir, ".swarm", "config.yml"), "", "utf-8");
    writeFileSync(
      join(homeDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports both global registry failures even when project config is present but empty", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(join(baseDir, ".swarm", "config.yml"), "", "utf-8");
    writeFileSync(
      join(homeDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports actionable problems when the agent registry contains an invalid project-local definition", () => {
    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports actionable problems when the agent registry contains an invalid global definition", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(homeDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("no .swarm/config.yml (CLI flags only)");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` still validates config preset when the global agent registry fails to load", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "preset: product-decision\n",
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).toContain("[OK] config preset");
    expect(result.stdout).toContain(
      'preset "product-decision" resolves (2 agent(s))',
    );
    expect(result.stdout).not.toContain("config agents");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` suppresses config agent checks when the global agent registry fails to load", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      ["agents:", "  - product-manager", "  - principal-engineer"].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` suppresses config agent checks when the agent registry fails to load", () => {
    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      ["agents:", "  - product-manager", "  - principal-engineer"].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` still validates config preset when the agent registry fails to load", () => {
    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "preset: product-decision\n",
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).toContain("[OK] config preset");
    expect(result.stdout).toContain(
      'preset "product-decision" resolves (2 agent(s))',
    );
    expect(result.stdout).not.toContain("config agents");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` skips preset agent validation when the agent registry fails to load", () => {
    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "preset: project-decision\n",
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "project-decision.yml"),
      [
        "name: project-decision",
        "agents:",
        "  - product-manager",
        "  - ghost-agent",
        "resolve: orchestrator",
      ].join("\n"),
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[OK] preset registry");
    expect(result.stdout).toContain("[OK] config preset");
    expect(result.stdout).toContain(
      'preset "project-decision" resolves (2 agent(s))',
    );
    expect(result.stdout).not.toContain(
      "unknown agent(s) referenced in config",
    );
    expect(result.stdout).not.toContain(
      "references unknown agent(s): ghost-agent",
    );
    expect(result.stdout).not.toContain("config agents");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports actionable problems when the preset registry contains an invalid project-local definition", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` reports actionable problems when the preset registry contains an invalid global definition", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(homeDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("no .swarm/config.yml (CLI flags only)");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` still validates config agents when the global preset registry fails to load", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      ["agents:", "  - product-manager", "  - principal-engineer"].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).toContain("[OK] config agents");
    expect(result.stdout).toContain("all 2 config agent(s) resolve");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` suppresses config preset checks when the global preset registry fails to load", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "preset: product-decision\n",
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` suppresses config preset checks when the preset registry fails to load", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "preset: broken-preset\n",
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` still validates config agents when the preset registry fails to load", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      ["agents:", "  - product-manager", "  - principal-engineer"].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[OK] agent registry");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).toContain("[OK] config agents");
    expect(result.stdout).toContain("all 2 config agent(s) resolve");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` suppresses config preset checks when both global registries fail to load", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "preset: product-decision\n",
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` suppresses config preset checks when both registries fail to load", () => {
    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "preset: product-decision\n",
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` suppresses config checks when both registries fail to load for explicit-agent config", () => {
    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      ["agents:", "  - product-manager", "  - principal-engineer"].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
    expect(result.stderr).toBe("");
  });

  it("`swarm doctor` suppresses config checks when both global registries fail to load for explicit-agent config", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      ["agents:", "  - product-manager", "  - principal-engineer"].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "agents", "broken-agent.md"),
      "name: broken-agent\ndescription: missing frontmatter fences\n",
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("swarm doctor: problems found");
    expect(result.stdout).toContain("[OK] project config");
    expect(result.stdout).toContain("loaded .swarm/config.yml");
    expect(result.stdout).toContain("[FAIL] agent registry");
    expect(result.stdout).toContain(
      "markdown definition is missing frontmatter fence",
    );
    expect(result.stdout).toContain("broken-agent.md");
    expect(result.stdout).toContain("[FAIL] preset registry");
    expect(result.stdout).toContain("invalid preset in");
    expect(result.stdout).toContain("broken-preset.yml");
    expect(result.stdout).toContain("agents: Too small");
    expect(result.stdout).not.toContain("config agents");
    expect(result.stdout).not.toContain("config preset");
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

  it("`swarm run` fails fast when project config is invalid", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "rounds: 9\n",
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

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("swarm: invalid .swarm/config.yml");
    expect(result.stderr).toContain("rounds");
    expect(existsSync(join(baseDir, ".swarm", "runs"))).toBe(false);
  });

  it("`swarm run` fails fast when project config references an unknown preset", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "preset: missing-preset\n",
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

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('swarm: unknown preset "missing-preset"');
    expect(existsSync(join(baseDir, ".swarm", "runs"))).toBe(false);
  });

  it("`swarm run` fails fast when project config references an unknown explicit agent", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      ["agents:", "  - ghost-agent", "  - product-manager"].join("\n"),
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

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('swarm: unknown agent "ghost-agent"');
    expect(existsSync(join(baseDir, ".swarm", "runs"))).toBe(false);
  });

  it("`swarm run` fails fast when project config preset references an unknown agent", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      "preset: project-decision\n",
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "project-decision.yml"),
      [
        "name: project-decision",
        "agents:",
        "  - product-manager",
        "  - ghost-agent",
        "goal: Use the config preset",
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

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('swarm: unknown agent "ghost-agent"');
    expect(existsSync(join(baseDir, ".swarm", "runs"))).toBe(false);
  });

  it("`swarm run` skips config preset resolution when explicit project config agents are valid", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "preset: missing-preset",
        "resolve: off",
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
    expect(result.stderr).not.toContain('unknown preset "missing-preset"');

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("off");
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

  it("project-local presets override the bundled preset of the same name", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "presets", "product-decision.yml"),
      [
        "name: product-decision",
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "resolve: agents",
        "goal: Decide on support policy",
        "decision: Ship / Defer / Sunset",
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
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Decide on support policy");
    expect(manifest.decision).toBe("Ship / Defer / Sunset");
  });

  it("global presets override the bundled preset of the same name", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(homeDir, ".swarm", "presets", "product-decision.yml"),
      [
        "name: product-decision",
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "resolve: agents",
        "goal: Decide on support policy",
        "decision: Ship / Defer / Sunset",
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
          HOME: homeDir,
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
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Decide on support policy");
    expect(manifest.decision).toBe("Ship / Defer / Sunset");
  });

  it("project-local presets override same-name global presets", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(homeDir, ".swarm", "presets", "product-decision.yml"),
      [
        "name: product-decision",
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "resolve: agents",
        "goal: Global policy decision",
        "decision: Global ship / Global defer / Global sunset",
      ].join("\n"),
      "utf-8",
    );

    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "presets", "product-decision.yml"),
      [
        "name: product-decision",
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "resolve: orchestrator",
        "goal: Project policy decision",
        "decision: Project ship / Project defer / Project sunset",
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
          HOME: homeDir,
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
    expect(manifest.goal).toBe("Project policy decision");
    expect(manifest.decision).toBe(
      "Project ship / Project defer / Project sunset",
    );
  });

  it("project-local agents override bundled agents of the same name", () => {
    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "agents", "product-manager.md"),
      [
        "---",
        "name: product-manager",
        "description: Project-local override for smoke coverage",
        "persona: Product manager with a project-local override",
        "backend: claude",
        "---",
        "PROJECT_AGENT_OVERRIDE_MARKER",
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
    const productManagerOutput = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    const principalEngineerOutput = readFileSync(
      join(runDir, "round-01", "agents", "principal-engineer.md"),
      "utf-8",
    );

    expect(productManagerOutput).toContain(
      "project-local product-manager override active in round 1",
    );
    expect(principalEngineerOutput).toContain(
      "principal-engineer recommends Adopt in round 1",
    );
  });

  it("project-local agents override bundled agents in explicit-agent runs", () => {
    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "agents", "product-manager.md"),
      [
        "---",
        "name: product-manager",
        "description: Project-local override for smoke coverage",
        "persona: Product manager with a project-local override",
        "backend: claude",
        "---",
        "PROJECT_AGENT_OVERRIDE_MARKER",
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
        "--agents",
        "product-manager,principal-engineer",
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
    const productManagerOutput = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    const principalEngineerOutput = readFileSync(
      join(runDir, "round-01", "agents", "principal-engineer.md"),
      "utf-8",
    );
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(productManagerOutput).toContain(
      "project-local product-manager override active in round 1",
    );
    expect(principalEngineerOutput).toContain(
      "principal-engineer recommends Adopt in round 1",
    );
  });

  it("project-local YAML agents override bundled agents in explicit-agent runs", () => {
    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "agents", "product-manager.yml"),
      [
        "name: product-manager",
        "description: Project-local YAML override for smoke coverage",
        "persona: Product manager with a project-local YAML override",
        "backend: claude",
        "prompt: PROJECT_AGENT_OVERRIDE_MARKER",
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
        "--agents",
        "product-manager,principal-engineer",
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
    const productManagerOutput = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    const principalEngineerOutput = readFileSync(
      join(runDir, "round-01", "agents", "principal-engineer.md"),
      "utf-8",
    );
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(productManagerOutput).toContain(
      "project-local product-manager override active in round 1",
    );
    expect(principalEngineerOutput).toContain(
      "principal-engineer recommends Adopt in round 1",
    );
  });

  it("global agents override bundled agents in explicit-agent runs", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(homeDir, ".swarm", "agents", "product-manager.md"),
      [
        "---",
        "name: product-manager",
        "description: Global override for smoke coverage",
        "persona: Product manager with a global override",
        "backend: claude",
        "---",
        "GLOBAL_AGENT_OVERRIDE_MARKER",
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
        "--agents",
        "product-manager,principal-engineer",
      ],
      {
        cwd: baseDir,
        encoding: "utf-8",
        env: {
          ...process.env,
          HOME: homeDir,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const productManagerOutput = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    const principalEngineerOutput = readFileSync(
      join(runDir, "round-01", "agents", "principal-engineer.md"),
      "utf-8",
    );
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(productManagerOutput).toContain(
      "global product-manager override active in round 1",
    );
    expect(principalEngineerOutput).toContain(
      "principal-engineer recommends Adopt in round 1",
    );
  });

  it("global YAML agents override bundled agents in explicit-agent runs", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(homeDir, ".swarm", "agents", "product-manager.yml"),
      [
        "name: product-manager",
        "description: Global YAML override for smoke coverage",
        "persona: Product manager with a global YAML override",
        "backend: claude",
        "prompt: GLOBAL_AGENT_OVERRIDE_MARKER",
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
        "--agents",
        "product-manager,principal-engineer",
      ],
      {
        cwd: baseDir,
        encoding: "utf-8",
        env: {
          ...process.env,
          HOME: homeDir,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const productManagerOutput = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    const principalEngineerOutput = readFileSync(
      join(runDir, "round-01", "agents", "principal-engineer.md"),
      "utf-8",
    );
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(productManagerOutput).toContain(
      "global product-manager override active in round 1",
    );
    expect(principalEngineerOutput).toContain(
      "principal-engineer recommends Adopt in round 1",
    );
  });

  it("project-local agents override same-name global agents in explicit-agent runs", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(homeDir, ".swarm", "agents", "product-manager.md"),
      [
        "---",
        "name: product-manager",
        "description: Global override for smoke coverage",
        "persona: Product manager with a global override",
        "backend: claude",
        "---",
        "GLOBAL_AGENT_OVERRIDE_MARKER",
      ].join("\n"),
      "utf-8",
    );

    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "agents", "product-manager.md"),
      [
        "---",
        "name: product-manager",
        "description: Project-local override for smoke coverage",
        "persona: Product manager with a project-local override",
        "backend: claude",
        "---",
        "PROJECT_AGENT_OVERRIDE_MARKER",
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
        "--agents",
        "product-manager,principal-engineer",
      ],
      {
        cwd: baseDir,
        encoding: "utf-8",
        env: {
          ...process.env,
          HOME: homeDir,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const productManagerOutput = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    const principalEngineerOutput = readFileSync(
      join(runDir, "round-01", "agents", "principal-engineer.md"),
      "utf-8",
    );
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(productManagerOutput).toContain(
      "project-local product-manager override active in round 1",
    );
    expect(productManagerOutput).not.toContain(
      "global product-manager override active in round 1",
    );
    expect(principalEngineerOutput).toContain(
      "principal-engineer recommends Adopt in round 1",
    );
  });

  it("project-local YAML agents override same-name global Markdown agents in explicit-agent runs", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(homeDir, ".swarm", "agents", "product-manager.md"),
      [
        "---",
        "name: product-manager",
        "description: Global markdown override for smoke coverage",
        "persona: Product manager with a global markdown override",
        "backend: claude",
        "---",
        "GLOBAL_AGENT_OVERRIDE_MARKER",
      ].join("\n"),
      "utf-8",
    );

    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "agents", "product-manager.yml"),
      [
        "name: product-manager",
        "description: Project-local YAML override for smoke coverage",
        "persona: Product manager with a project-local YAML override",
        "backend: claude",
        "prompt: PROJECT_AGENT_OVERRIDE_MARKER",
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
        "--agents",
        "product-manager,principal-engineer",
      ],
      {
        cwd: baseDir,
        encoding: "utf-8",
        env: {
          ...process.env,
          HOME: homeDir,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const productManagerOutput = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    const principalEngineerOutput = readFileSync(
      join(runDir, "round-01", "agents", "principal-engineer.md"),
      "utf-8",
    );
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(productManagerOutput).toContain(
      "project-local product-manager override active in round 1",
    );
    expect(productManagerOutput).not.toContain(
      "global product-manager override active in round 1",
    );
    expect(principalEngineerOutput).toContain(
      "principal-engineer recommends Adopt in round 1",
    );
  });

  it("project-local Markdown agents override same-name global YAML agents in explicit-agent runs", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(homeDir, ".swarm", "agents", "product-manager.yml"),
      [
        "name: product-manager",
        "description: Global YAML override for smoke coverage",
        "persona: Product manager with a global YAML override",
        "backend: claude",
        "prompt: GLOBAL_AGENT_OVERRIDE_MARKER",
      ].join("\n"),
      "utf-8",
    );

    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "agents", "product-manager.md"),
      [
        "---",
        "name: product-manager",
        "description: Project-local markdown override for smoke coverage",
        "persona: Product manager with a project-local markdown override",
        "backend: claude",
        "---",
        "PROJECT_AGENT_OVERRIDE_MARKER",
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
        "--agents",
        "product-manager,principal-engineer",
      ],
      {
        cwd: baseDir,
        encoding: "utf-8",
        env: {
          ...process.env,
          HOME: homeDir,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const productManagerOutput = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    const principalEngineerOutput = readFileSync(
      join(runDir, "round-01", "agents", "principal-engineer.md"),
      "utf-8",
    );
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(productManagerOutput).toContain(
      "project-local product-manager override active in round 1",
    );
    expect(productManagerOutput).not.toContain(
      "global product-manager override active in round 1",
    );
    expect(principalEngineerOutput).toContain(
      "principal-engineer recommends Adopt in round 1",
    );
  });

  it("project-local YAML agents override bundled agents of the same name", () => {
    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "agents", "product-manager.yml"),
      [
        "name: product-manager",
        "description: Project-local YAML override for smoke coverage",
        "persona: Product manager with a project-local YAML override",
        "backend: claude",
        "prompt: PROJECT_AGENT_OVERRIDE_MARKER",
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
    const productManagerOutput = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    const principalEngineerOutput = readFileSync(
      join(runDir, "round-01", "agents", "principal-engineer.md"),
      "utf-8",
    );

    expect(productManagerOutput).toContain(
      "project-local product-manager override active in round 1",
    );
    expect(principalEngineerOutput).toContain(
      "principal-engineer recommends Adopt in round 1",
    );
  });

  it("global agents override bundled agents of the same name", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(homeDir, ".swarm", "agents", "product-manager.md"),
      [
        "---",
        "name: product-manager",
        "description: Global override for smoke coverage",
        "persona: Product manager with a global override",
        "backend: claude",
        "---",
        "GLOBAL_AGENT_OVERRIDE_MARKER",
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
          HOME: homeDir,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const productManagerOutput = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    const principalEngineerOutput = readFileSync(
      join(runDir, "round-01", "agents", "principal-engineer.md"),
      "utf-8",
    );

    expect(productManagerOutput).toContain(
      "global product-manager override active in round 1",
    );
    expect(principalEngineerOutput).toContain(
      "principal-engineer recommends Adopt in round 1",
    );
  });

  it("global YAML agents override bundled agents of the same name", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(homeDir, ".swarm", "agents", "product-manager.yml"),
      [
        "name: product-manager",
        "description: Global YAML override for smoke coverage",
        "persona: Product manager with a global YAML override",
        "backend: claude",
        "prompt: GLOBAL_AGENT_OVERRIDE_MARKER",
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
          HOME: homeDir,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const productManagerOutput = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    const principalEngineerOutput = readFileSync(
      join(runDir, "round-01", "agents", "principal-engineer.md"),
      "utf-8",
    );

    expect(productManagerOutput).toContain(
      "global product-manager override active in round 1",
    );
    expect(principalEngineerOutput).toContain(
      "principal-engineer recommends Adopt in round 1",
    );
  });

  it("project-local agents override same-name global agents", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(homeDir, ".swarm", "agents", "product-manager.md"),
      [
        "---",
        "name: product-manager",
        "description: Global override for smoke coverage",
        "persona: Product manager with a global override",
        "backend: claude",
        "---",
        "GLOBAL_AGENT_OVERRIDE_MARKER",
      ].join("\n"),
      "utf-8",
    );

    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "agents", "product-manager.md"),
      [
        "---",
        "name: product-manager",
        "description: Project-local override for smoke coverage",
        "persona: Product manager with a project-local override",
        "backend: claude",
        "---",
        "PROJECT_AGENT_OVERRIDE_MARKER",
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
          HOME: homeDir,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const productManagerOutput = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    const principalEngineerOutput = readFileSync(
      join(runDir, "round-01", "agents", "principal-engineer.md"),
      "utf-8",
    );

    expect(productManagerOutput).toContain(
      "project-local product-manager override active in round 1",
    );
    expect(productManagerOutput).not.toContain(
      "global product-manager override active in round 1",
    );
    expect(principalEngineerOutput).toContain(
      "principal-engineer recommends Adopt in round 1",
    );
  });

  it("project-local YAML agents override same-name global Markdown agents", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(homeDir, ".swarm", "agents", "product-manager.md"),
      [
        "---",
        "name: product-manager",
        "description: Global markdown override for smoke coverage",
        "persona: Product manager with a global markdown override",
        "backend: claude",
        "---",
        "GLOBAL_AGENT_OVERRIDE_MARKER",
      ].join("\n"),
      "utf-8",
    );

    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "agents", "product-manager.yml"),
      [
        "name: product-manager",
        "description: Project-local YAML override for smoke coverage",
        "persona: Product manager with a project-local YAML override",
        "backend: claude",
        "prompt: PROJECT_AGENT_OVERRIDE_MARKER",
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
          HOME: homeDir,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const productManagerOutput = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    const principalEngineerOutput = readFileSync(
      join(runDir, "round-01", "agents", "principal-engineer.md"),
      "utf-8",
    );

    expect(productManagerOutput).toContain(
      "project-local product-manager override active in round 1",
    );
    expect(productManagerOutput).not.toContain(
      "global product-manager override active in round 1",
    );
    expect(principalEngineerOutput).toContain(
      "principal-engineer recommends Adopt in round 1",
    );
  });

  it("project-local Markdown agents override same-name global YAML agents", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(homeDir, ".swarm", "agents", "product-manager.yml"),
      [
        "name: product-manager",
        "description: Global YAML override for smoke coverage",
        "persona: Product manager with a global YAML override",
        "backend: claude",
        "prompt: GLOBAL_AGENT_OVERRIDE_MARKER",
      ].join("\n"),
      "utf-8",
    );

    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "agents", "product-manager.md"),
      [
        "---",
        "name: product-manager",
        "description: Project-local markdown override for smoke coverage",
        "persona: Product manager with a project-local markdown override",
        "backend: claude",
        "---",
        "PROJECT_AGENT_OVERRIDE_MARKER",
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
          HOME: homeDir,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const productManagerOutput = readFileSync(
      join(runDir, "round-01", "agents", "product-manager.md"),
      "utf-8",
    );
    const principalEngineerOutput = readFileSync(
      join(runDir, "round-01", "agents", "principal-engineer.md"),
      "utf-8",
    );

    expect(productManagerOutput).toContain(
      "project-local product-manager override active in round 1",
    );
    expect(productManagerOutput).not.toContain(
      "global product-manager override active in round 1",
    );
    expect(principalEngineerOutput).toContain(
      "principal-engineer recommends Adopt in round 1",
    );
  });

  it("repeated CLI --doc flags override config docs and land in the seed brief", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      ["preset: product-decision", "docs:", "  - docs/from-config.md"].join(
        "\n",
      ),
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
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );
    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");

    expect(manifest.preset).toBe("product-decision");
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(seedBrief).toContain(
      "Carry-forward docs: docs/architecture.md, docs/decision-log.md",
    );
    expect(seedBrief).toContain("Selection source: preset");
    expect(seedBrief).toContain("Preset: product-decision");
    expect(seedBrief).toContain("- docs/architecture.md");
    expect(seedBrief).toContain("- docs/decision-log.md");
    expect(seedBrief).not.toContain("docs/from-config.md");
  });

  it("config explicit-agent runs ignore preset names but retain other config defaults", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "preset: missing-preset",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
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

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Goal: Decide on migration strategy");
    expect(seedBrief).toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).toContain("Carry-forward docs: docs/architecture.md");
    expect(seedBrief).not.toContain("Preset: missing-preset");
  });

  it("config explicit-agent runs ignore invalid preset files", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "preset: broken-preset",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
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
    expect(result.stderr).not.toContain("invalid preset");

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).not.toContain("Preset: broken-preset");
  });

  it("config explicit-agent runs do not inherit defaults from a valid preset", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "preset: product-decision",
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
    expect(manifest.resolveMode).toBe("off");
    expect(manifest.goal).toBeNull();
    expect(manifest.decision).toBeNull();

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain("Resolution mode: off");
    expect(seedBrief).toContain("Goal: n/a");
    expect(seedBrief).toContain("Decision target: n/a");
    expect(seedBrief).not.toContain("Preset: product-decision");
  });

  it("repeated CLI --doc flags override config docs on explicit-agent runs", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
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
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );
    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain(
      "Carry-forward docs: docs/architecture.md, docs/decision-log.md",
    );
    expect(seedBrief).toContain("- docs/architecture.md");
    expect(seedBrief).toContain("- docs/decision-log.md");
    expect(seedBrief).not.toContain("docs/from-config.md");
    expect(seedBrief).not.toContain("Preset: product-decision");
  });

  it("CLI intent flags override project-config intent on config explicit-agent runs", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
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
        "--resolve",
        "agents",
        "--goal",
        "Choose a phased rollout plan",
        "--decision",
        "Ship now / Pilot first / Hold",
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

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Choose a phased rollout plan");
    expect(manifest.decision).toBe("Ship now / Pilot first / Hold");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain("Resolution mode: agents");
    expect(seedBrief).toContain("Goal: Choose a phased rollout plan");
    expect(seedBrief).toContain(
      "Decision target: Ship now / Pilot first / Hold",
    );
    expect(seedBrief).toContain("Carry-forward docs: docs/from-config.md");
    expect(seedBrief).not.toContain("Goal: Decide on migration strategy");
    expect(seedBrief).not.toContain("Decision target: Adopt / Defer / Reject");
  });

  it("CLI --preset overrides configured explicit agents but preserves other config defaults", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - ghost-agent",
        "  - shadow-agent",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
        "docs:",
        "  - docs/architecture.md",
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
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: preset");
    expect(seedBrief).toContain("Preset: product-decision");
    expect(seedBrief).toContain("Goal: Decide on migration strategy");
    expect(seedBrief).toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).toContain("Carry-forward docs: docs/architecture.md");
    expect(seedBrief).not.toContain("ghost-agent");
    expect(seedBrief).not.toContain("shadow-agent");
  });

  it("CLI --preset keeps preset selection while repeated CLI --doc flags replace config docs", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - ghost-agent",
        "  - shadow-agent",
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
        "--preset",
        "product-decision",
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
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );
    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");

    expect(manifest.preset).toBe("product-decision");
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(seedBrief).toContain("Selection source: preset");
    expect(seedBrief).toContain("Preset: product-decision");
    expect(seedBrief).toContain(
      "Carry-forward docs: docs/architecture.md, docs/decision-log.md",
    );
    expect(seedBrief).toContain("- docs/architecture.md");
    expect(seedBrief).toContain("- docs/decision-log.md");
    expect(seedBrief).not.toContain("docs/from-config.md");
    expect(seedBrief).not.toContain("ghost-agent");
    expect(seedBrief).not.toContain("shadow-agent");
  });

  it("CLI --preset keeps preset selection while CLI docs and intent flags override config metadata", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - ghost-agent",
        "  - shadow-agent",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
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
        "--preset",
        "product-decision",
        "--resolve",
        "agents",
        "--goal",
        "Choose a phased rollout plan",
        "--decision",
        "Ship now / Pilot first / Hold",
        "--doc",
        "docs/from-cli-a.md",
        "--doc",
        "docs/from-cli-b.md",
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
    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");

    expect(manifest.preset).toBe("product-decision");
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Choose a phased rollout plan");
    expect(manifest.decision).toBe("Ship now / Pilot first / Hold");
    expect(seedBrief).toContain("Selection source: preset");
    expect(seedBrief).toContain("Preset: product-decision");
    expect(seedBrief).toContain("Resolution mode: agents");
    expect(seedBrief).toContain("Goal: Choose a phased rollout plan");
    expect(seedBrief).toContain(
      "Decision target: Ship now / Pilot first / Hold",
    );
    expect(seedBrief).toContain(
      "Carry-forward docs: docs/from-cli-a.md, docs/from-cli-b.md",
    );
    expect(seedBrief).toContain("- docs/from-cli-a.md");
    expect(seedBrief).toContain("- docs/from-cli-b.md");
    expect(seedBrief).not.toContain("docs/from-config.md");
    expect(seedBrief).not.toContain("Goal: Decide on migration strategy");
    expect(seedBrief).not.toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).not.toContain("ghost-agent");
    expect(seedBrief).not.toContain("shadow-agent");
  });

  it("CLI --preset keeps preset selection while CLI intent flags override config intent", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "agents:",
        "  - ghost-agent",
        "  - shadow-agent",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
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
        "--preset",
        "product-decision",
        "--resolve",
        "agents",
        "--goal",
        "Choose a phased rollout plan",
        "--decision",
        "Ship now / Pilot first / Hold",
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
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Choose a phased rollout plan");
    expect(manifest.decision).toBe("Ship now / Pilot first / Hold");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: preset");
    expect(seedBrief).toContain("Preset: product-decision");
    expect(seedBrief).toContain("Resolution mode: agents");
    expect(seedBrief).toContain("Goal: Choose a phased rollout plan");
    expect(seedBrief).toContain(
      "Decision target: Ship now / Pilot first / Hold",
    );
    expect(seedBrief).toContain("Carry-forward docs: docs/from-config.md");
    expect(seedBrief).not.toContain("Goal: Decide on migration strategy");
    expect(seedBrief).not.toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).not.toContain("ghost-agent");
    expect(seedBrief).not.toContain("shadow-agent");
  });

  it("explicit CLI --agents override CLI --preset", () => {
    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "1",
        "Should we adopt server components?",
        "--preset",
        "product-decision",
        "--agents",
        "product-manager,principal-engineer",
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

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("off");
    expect(manifest.goal).toBeNull();
    expect(manifest.decision).toBeNull();

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain("Agents: product-manager, principal-engineer");
    expect(seedBrief).not.toContain("Preset: product-decision");
  });

  it("explicit CLI --agents still preserve project-config defaults while ignoring CLI --preset", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
        "docs:",
        "  - docs/architecture.md",
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
        "--agents",
        "product-manager,principal-engineer",
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

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain("Resolution mode: orchestrator");
    expect(seedBrief).toContain("Goal: Decide on migration strategy");
    expect(seedBrief).toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).toContain("Carry-forward docs: docs/architecture.md");
    expect(seedBrief).not.toContain("Preset: product-decision");
  });

  it("explicit CLI --agents override both CLI and configured presets while preserving other config defaults", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: project-decision",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
        "docs:",
        "  - docs/architecture.md",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "project-decision.yml"),
      [
        "name: project-decision",
        "agents:",
        "  - principal-engineer",
        "  - product-manager",
        "resolve: off",
        "goal: Use the config preset",
        "decision: Config preset should win",
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
        "--agents",
        "product-manager,principal-engineer",
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

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain("Resolution mode: orchestrator");
    expect(seedBrief).toContain("Goal: Decide on migration strategy");
    expect(seedBrief).toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).toContain("Carry-forward docs: docs/architecture.md");
    expect(seedBrief).not.toContain("Preset: product-decision");
    expect(seedBrief).not.toContain("Preset: project-decision");
    expect(seedBrief).not.toContain(
      "Agents: principal-engineer, product-manager",
    );
  });

  it("explicit CLI --agents override both CLI and configured presets while repeated CLI --doc flags replace config docs", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: project-decision",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
        "docs:",
        "  - docs/from-config.md",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "project-decision.yml"),
      [
        "name: project-decision",
        "agents:",
        "  - principal-engineer",
        "  - product-manager",
        "resolve: off",
        "goal: Use the config preset",
        "decision: Config preset should win",
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
        "--agents",
        "product-manager,principal-engineer",
        "--doc",
        "docs/from-cli-a.md",
        "--doc",
        "docs/from-cli-b.md",
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

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain("Resolution mode: orchestrator");
    expect(seedBrief).toContain("Goal: Decide on migration strategy");
    expect(seedBrief).toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).toContain(
      "Carry-forward docs: docs/from-cli-a.md, docs/from-cli-b.md",
    );
    expect(seedBrief).toContain("- docs/from-cli-a.md");
    expect(seedBrief).toContain("- docs/from-cli-b.md");
    expect(seedBrief).not.toContain("docs/from-config.md");
    expect(seedBrief).not.toContain("Preset: product-decision");
    expect(seedBrief).not.toContain("Preset: project-decision");
    expect(seedBrief).not.toContain(
      "Agents: principal-engineer, product-manager",
    );
  });

  it("explicit CLI --agents override both CLI and configured presets while CLI intent flags override config intent", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: project-decision",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
        "docs:",
        "  - docs/architecture.md",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "project-decision.yml"),
      [
        "name: project-decision",
        "agents:",
        "  - principal-engineer",
        "  - product-manager",
        "resolve: off",
        "goal: Use the config preset",
        "decision: Config preset should win",
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
        "--agents",
        "product-manager,principal-engineer",
        "--resolve",
        "agents",
        "--goal",
        "Choose a phased rollout plan",
        "--decision",
        "Ship now / Pilot first / Hold",
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

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Choose a phased rollout plan");
    expect(manifest.decision).toBe("Ship now / Pilot first / Hold");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain("Resolution mode: agents");
    expect(seedBrief).toContain("Goal: Choose a phased rollout plan");
    expect(seedBrief).toContain(
      "Decision target: Ship now / Pilot first / Hold",
    );
    expect(seedBrief).toContain("Carry-forward docs: docs/architecture.md");
    expect(seedBrief).not.toContain("Preset: product-decision");
    expect(seedBrief).not.toContain("Preset: project-decision");
    expect(seedBrief).not.toContain(
      "Agents: principal-engineer, product-manager",
    );
    expect(seedBrief).not.toContain("Goal: Decide on migration strategy");
    expect(seedBrief).not.toContain("Decision target: Adopt / Defer / Reject");
  });

  it("explicit CLI --agents override both CLI and configured presets while CLI docs and intent flags override config metadata", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: project-decision",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
        "docs:",
        "  - docs/from-config.md",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "project-decision.yml"),
      [
        "name: project-decision",
        "agents:",
        "  - principal-engineer",
        "  - product-manager",
        "resolve: off",
        "goal: Use the config preset",
        "decision: Config preset should win",
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
        "--agents",
        "product-manager,principal-engineer",
        "--resolve",
        "agents",
        "--goal",
        "Choose a phased rollout plan",
        "--decision",
        "Ship now / Pilot first / Hold",
        "--doc",
        "docs/from-cli-a.md",
        "--doc",
        "docs/from-cli-b.md",
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

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Choose a phased rollout plan");
    expect(manifest.decision).toBe("Ship now / Pilot first / Hold");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain("Resolution mode: agents");
    expect(seedBrief).toContain("Goal: Choose a phased rollout plan");
    expect(seedBrief).toContain(
      "Decision target: Ship now / Pilot first / Hold",
    );
    expect(seedBrief).toContain(
      "Carry-forward docs: docs/from-cli-a.md, docs/from-cli-b.md",
    );
    expect(seedBrief).toContain("- docs/from-cli-a.md");
    expect(seedBrief).toContain("- docs/from-cli-b.md");
    expect(seedBrief).not.toContain("docs/from-config.md");
    expect(seedBrief).not.toContain("Preset: product-decision");
    expect(seedBrief).not.toContain("Preset: project-decision");
    expect(seedBrief).not.toContain(
      "Agents: principal-engineer, product-manager",
    );
    expect(seedBrief).not.toContain("Goal: Decide on migration strategy");
    expect(seedBrief).not.toContain("Decision target: Adopt / Defer / Reject");
  });

  it("explicit CLI --agents keep explicit-agent selection while CLI docs and intent override config metadata", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
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
        "--preset",
        "product-decision",
        "--agents",
        "product-manager,principal-engineer",
        "--resolve",
        "agents",
        "--goal",
        "Choose a phased rollout plan",
        "--decision",
        "Ship now / Pilot first / Hold",
        "--doc",
        "docs/from-cli-a.md",
        "--doc",
        "docs/from-cli-b.md",
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

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Choose a phased rollout plan");
    expect(manifest.decision).toBe("Ship now / Pilot first / Hold");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain("Resolution mode: agents");
    expect(seedBrief).toContain("Goal: Choose a phased rollout plan");
    expect(seedBrief).toContain(
      "Decision target: Ship now / Pilot first / Hold",
    );
    expect(seedBrief).toContain(
      "Carry-forward docs: docs/from-cli-a.md, docs/from-cli-b.md",
    );
    expect(seedBrief).not.toContain("Preset: product-decision");
    expect(seedBrief).not.toContain("Carry-forward docs: docs/from-config.md");
    expect(seedBrief).not.toContain("Goal: Decide on migration strategy");
    expect(seedBrief).not.toContain("Decision target: Adopt / Defer / Reject");
  });

  it("explicit CLI --agents override a configured preset", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: product-decision",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
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
        "--agents",
        "product-manager,principal-engineer",
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

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).not.toContain("Preset: product-decision");
  });

  it("explicit CLI --agents ignore configured preset names while preserving other config defaults", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: missing-preset",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
        "docs:",
        "  - docs/architecture.md",
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
        "--agents",
        "product-manager,principal-engineer",
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
    expect(result.stderr).not.toContain('unknown preset "missing-preset"');

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain("Resolution mode: orchestrator");
    expect(seedBrief).toContain("Goal: Decide on migration strategy");
    expect(seedBrief).toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).toContain("Carry-forward docs: docs/architecture.md");
    expect(seedBrief).not.toContain("Preset: missing-preset");
  });

  it("explicit CLI --agents ignore invalid configured preset files while preserving other config defaults", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: broken-preset",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
        "docs:",
        "  - docs/architecture.md",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "1",
        "Should we adopt server components?",
        "--agents",
        "product-manager,principal-engineer",
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
    expect(result.stderr).not.toContain("invalid preset");

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain("Resolution mode: orchestrator");
    expect(seedBrief).toContain("Goal: Decide on migration strategy");
    expect(seedBrief).toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).toContain("Carry-forward docs: docs/architecture.md");
    expect(seedBrief).not.toContain("Preset: broken-preset");
  });

  it("explicit CLI --agents ignore invalid configured global preset files while preserving other config defaults", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: broken-preset",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
        "docs:",
        "  - docs/architecture.md",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
      "utf-8",
    );

    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "1",
        "Should we adopt server components?",
        "--agents",
        "product-manager,principal-engineer",
      ],
      {
        cwd: baseDir,
        encoding: "utf-8",
        env: {
          ...process.env,
          HOME: homeDir,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("invalid preset");

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain("Resolution mode: orchestrator");
    expect(seedBrief).toContain("Goal: Decide on migration strategy");
    expect(seedBrief).toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).toContain("Carry-forward docs: docs/architecture.md");
    expect(seedBrief).not.toContain("Preset: broken-preset");
  });

  it("explicit CLI --agents override a configured preset while repeated CLI --doc flags replace config docs", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      ["preset: product-decision", "docs:", "  - docs/from-config.md"].join(
        "\n",
      ),
      "utf-8",
    );

    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "1",
        "Should we adopt server components?",
        "--agents",
        "product-manager,principal-engineer",
        "--doc",
        "docs/from-cli-a.md",
        "--doc",
        "docs/from-cli-b.md",
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
    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain(
      "Carry-forward docs: docs/from-cli-a.md, docs/from-cli-b.md",
    );
    expect(seedBrief).toContain("- docs/from-cli-a.md");
    expect(seedBrief).toContain("- docs/from-cli-b.md");
    expect(seedBrief).not.toContain("docs/from-config.md");
    expect(seedBrief).not.toContain("Preset: product-decision");
  });

  it("explicit CLI --agents override a configured preset while CLI intent flags override config intent", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: product-decision",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
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
        "--agents",
        "product-manager,principal-engineer",
        "--resolve",
        "agents",
        "--goal",
        "Choose a phased rollout plan",
        "--decision",
        "Ship now / Pilot first / Hold",
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

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Choose a phased rollout plan");
    expect(manifest.decision).toBe("Ship now / Pilot first / Hold");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain("Resolution mode: agents");
    expect(seedBrief).toContain("Goal: Choose a phased rollout plan");
    expect(seedBrief).toContain(
      "Decision target: Ship now / Pilot first / Hold",
    );
    expect(seedBrief).toContain("Carry-forward docs: docs/from-config.md");
    expect(seedBrief).not.toContain("Preset: product-decision");
    expect(seedBrief).not.toContain("Goal: Decide on migration strategy");
    expect(seedBrief).not.toContain("Decision target: Adopt / Defer / Reject");
  });

  it("explicit CLI --agents override a configured preset while CLI docs and intent flags override config metadata", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: product-decision",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
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
        "--agents",
        "product-manager,principal-engineer",
        "--resolve",
        "agents",
        "--goal",
        "Choose a phased rollout plan",
        "--decision",
        "Ship now / Pilot first / Hold",
        "--doc",
        "docs/from-cli-a.md",
        "--doc",
        "docs/from-cli-b.md",
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
    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");

    expect(manifest.preset).toBeNull();
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Choose a phased rollout plan");
    expect(manifest.decision).toBe("Ship now / Pilot first / Hold");

    expect(seedBrief).toContain("Selection source: explicit-agents");
    expect(seedBrief).toContain("Preset: none");
    expect(seedBrief).toContain("Resolution mode: agents");
    expect(seedBrief).toContain("Goal: Choose a phased rollout plan");
    expect(seedBrief).toContain(
      "Decision target: Ship now / Pilot first / Hold",
    );
    expect(seedBrief).toContain(
      "Carry-forward docs: docs/from-cli-a.md, docs/from-cli-b.md",
    );
    expect(seedBrief).toContain("- docs/from-cli-a.md");
    expect(seedBrief).toContain("- docs/from-cli-b.md");
    expect(seedBrief).not.toContain("docs/from-config.md");
    expect(seedBrief).not.toContain("Preset: product-decision");
    expect(seedBrief).not.toContain("Goal: Decide on migration strategy");
    expect(seedBrief).not.toContain("Decision target: Adopt / Defer / Reject");
  });

  it("CLI --preset overrides a configured preset while preserving other config defaults", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: project-decision",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: agents",
        "docs:",
        "  - docs/from-config.md",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "project-decision.yml"),
      [
        "name: project-decision",
        "agents:",
        "  - principal-engineer",
        "  - product-manager",
        "resolve: off",
        "goal: Use the config preset",
        "decision: Config preset should win",
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
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: preset");
    expect(seedBrief).toContain("Preset: product-decision");
    expect(seedBrief).toContain("Resolution mode: agents");
    expect(seedBrief).toContain("Goal: Decide on migration strategy");
    expect(seedBrief).toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).toContain("Carry-forward docs: docs/from-config.md");
    expect(seedBrief).not.toContain("Preset: project-decision");
    expect(seedBrief).not.toContain(
      "Agents: principal-engineer, product-manager",
    );
  });

  it("CLI --preset ignores a missing configured preset while preserving other config defaults", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: missing-preset",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: agents",
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
    expect(result.stderr).not.toContain('unknown preset "missing-preset"');

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBe("product-decision");
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: preset");
    expect(seedBrief).toContain("Preset: product-decision");
    expect(seedBrief).toContain("Resolution mode: agents");
    expect(seedBrief).toContain("Goal: Decide on migration strategy");
    expect(seedBrief).toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).toContain("Carry-forward docs: docs/from-config.md");
    expect(seedBrief).not.toContain("Preset: missing-preset");
  });

  it("CLI --preset ignores invalid configured preset files while preserving other config defaults", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: broken-preset",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: agents",
        "docs:",
        "  - docs/from-config.md",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
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
    expect(result.stderr).not.toContain("invalid preset");

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBe("product-decision");
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: preset");
    expect(seedBrief).toContain("Preset: product-decision");
    expect(seedBrief).toContain("Resolution mode: agents");
    expect(seedBrief).toContain("Goal: Decide on migration strategy");
    expect(seedBrief).toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).toContain("Carry-forward docs: docs/from-config.md");
    expect(seedBrief).not.toContain("Preset: broken-preset");
  });

  it("CLI --preset ignores invalid configured global preset files while preserving other config defaults", () => {
    const homeDir = join(baseDir, "home");
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    mkdirSync(join(homeDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: broken-preset",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: agents",
        "docs:",
        "  - docs/from-config.md",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(homeDir, ".swarm", "presets", "broken-preset.yml"),
      "name: broken-preset\nagents: [solo]\n",
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
          HOME: homeDir,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("invalid preset");

    const runsDir = join(baseDir, ".swarm", "runs");
    const runDir = join(runsDir, readdirSync(runsDir)[0]);
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.preset).toBe("product-decision");
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: preset");
    expect(seedBrief).toContain("Preset: product-decision");
    expect(seedBrief).toContain("Resolution mode: agents");
    expect(seedBrief).toContain("Goal: Decide on migration strategy");
    expect(seedBrief).toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).toContain("Carry-forward docs: docs/from-config.md");
    expect(seedBrief).not.toContain("Preset: broken-preset");
  });

  it("CLI --preset overrides a configured preset while repeated CLI --doc flags replace config docs", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: project-decision",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: agents",
        "docs:",
        "  - docs/from-config.md",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "project-decision.yml"),
      [
        "name: project-decision",
        "agents:",
        "  - principal-engineer",
        "  - product-manager",
        "resolve: off",
        "goal: Use the config preset",
        "decision: Config preset should win",
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
        "--doc",
        "docs/from-cli-a.md",
        "--doc",
        "docs/from-cli-b.md",
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
    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");

    expect(manifest.preset).toBe("product-decision");
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Decide on migration strategy");
    expect(manifest.decision).toBe("Adopt / Defer / Reject");

    expect(seedBrief).toContain("Selection source: preset");
    expect(seedBrief).toContain("Preset: product-decision");
    expect(seedBrief).toContain("Resolution mode: agents");
    expect(seedBrief).toContain("Goal: Decide on migration strategy");
    expect(seedBrief).toContain("Decision target: Adopt / Defer / Reject");
    expect(seedBrief).toContain(
      "Carry-forward docs: docs/from-cli-a.md, docs/from-cli-b.md",
    );
    expect(seedBrief).toContain("- docs/from-cli-a.md");
    expect(seedBrief).toContain("- docs/from-cli-b.md");
    expect(seedBrief).not.toContain("docs/from-config.md");
    expect(seedBrief).not.toContain("Preset: project-decision");
    expect(seedBrief).not.toContain(
      "Agents: principal-engineer, product-manager",
    );
  });

  it("CLI --preset overrides a configured preset while CLI intent flags override config intent", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: project-decision",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: agents",
        "docs:",
        "  - docs/from-config.md",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "project-decision.yml"),
      [
        "name: project-decision",
        "agents:",
        "  - principal-engineer",
        "  - product-manager",
        "resolve: off",
        "goal: Use the config preset",
        "decision: Config preset should win",
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
        "--resolve",
        "orchestrator",
        "--goal",
        "Choose a phased rollout plan",
        "--decision",
        "Ship now / Pilot first / Hold",
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
    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");

    expect(manifest.preset).toBe("product-decision");
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.goal).toBe("Choose a phased rollout plan");
    expect(manifest.decision).toBe("Ship now / Pilot first / Hold");

    expect(seedBrief).toContain("Selection source: preset");
    expect(seedBrief).toContain("Preset: product-decision");
    expect(seedBrief).toContain("Resolution mode: orchestrator");
    expect(seedBrief).toContain("Goal: Choose a phased rollout plan");
    expect(seedBrief).toContain(
      "Decision target: Ship now / Pilot first / Hold",
    );
    expect(seedBrief).toContain("Carry-forward docs: docs/from-config.md");
    expect(seedBrief).not.toContain("Preset: project-decision");
    expect(seedBrief).not.toContain(
      "Agents: principal-engineer, product-manager",
    );
    expect(seedBrief).not.toContain("Goal: Decide on migration strategy");
    expect(seedBrief).not.toContain("Decision target: Adopt / Defer / Reject");
  });

  it("CLI --preset overrides a configured preset while CLI docs and intent flags override config metadata", () => {
    mkdirSync(join(baseDir, ".swarm", "presets"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: project-decision",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: agents",
        "docs:",
        "  - docs/from-config.md",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(baseDir, ".swarm", "presets", "project-decision.yml"),
      [
        "name: project-decision",
        "agents:",
        "  - principal-engineer",
        "  - product-manager",
        "resolve: off",
        "goal: Use the config preset",
        "decision: Config preset should win",
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
        "--resolve",
        "orchestrator",
        "--goal",
        "Choose a phased rollout plan",
        "--decision",
        "Ship now / Pilot first / Hold",
        "--doc",
        "docs/from-cli-a.md",
        "--doc",
        "docs/from-cli-b.md",
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
    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");

    expect(manifest.preset).toBe("product-decision");
    expect(manifest.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.goal).toBe("Choose a phased rollout plan");
    expect(manifest.decision).toBe("Ship now / Pilot first / Hold");

    expect(seedBrief).toContain("Selection source: preset");
    expect(seedBrief).toContain("Preset: product-decision");
    expect(seedBrief).toContain("Resolution mode: orchestrator");
    expect(seedBrief).toContain("Goal: Choose a phased rollout plan");
    expect(seedBrief).toContain(
      "Decision target: Ship now / Pilot first / Hold",
    );
    expect(seedBrief).toContain(
      "Carry-forward docs: docs/from-cli-a.md, docs/from-cli-b.md",
    );
    expect(seedBrief).toContain("- docs/from-cli-a.md");
    expect(seedBrief).toContain("- docs/from-cli-b.md");
    expect(seedBrief).not.toContain("docs/from-config.md");
    expect(seedBrief).not.toContain("Preset: project-decision");
    expect(seedBrief).not.toContain(
      "Agents: principal-engineer, product-manager",
    );
    expect(seedBrief).not.toContain("Goal: Decide on migration strategy");
    expect(seedBrief).not.toContain("Decision target: Adopt / Defer / Reject");
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

  it("CLI intent flags override project-config intent on config-preset runs", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      [
        "preset: product-decision",
        "goal: Decide on migration strategy",
        "decision: Adopt / Defer / Reject",
        "resolve: orchestrator",
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
        "--resolve",
        "agents",
        "--goal",
        "Choose a phased rollout plan",
        "--decision",
        "Ship now / Pilot first / Hold",
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
    expect(manifest.resolveMode).toBe("agents");
    expect(manifest.goal).toBe("Choose a phased rollout plan");
    expect(manifest.decision).toBe("Ship now / Pilot first / Hold");

    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Selection source: preset");
    expect(seedBrief).toContain("Preset: product-decision");
    expect(seedBrief).toContain("Resolution mode: agents");
    expect(seedBrief).toContain("Goal: Choose a phased rollout plan");
    expect(seedBrief).toContain(
      "Decision target: Ship now / Pilot first / Hold",
    );
    expect(seedBrief).toContain("Carry-forward docs: docs/from-config.md");
    expect(seedBrief).not.toContain("Goal: Decide on migration strategy");
    expect(seedBrief).not.toContain("Decision target: Adopt / Defer / Reject");
  });
});
