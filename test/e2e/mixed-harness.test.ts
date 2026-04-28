/**
 * Mixed-harness end-to-end coverage (M7-08 / NGX-123).
 *
 * Validates that a single swarm run can dispatch agents through different
 * harness adapters in the same round — one agent through the Claude CLI
 * (`harness: claude`) and another through the Codex CLI (`harness: codex`)
 * — and that the resolved runtime is faithfully captured in both
 * `manifest.json` (agentRuntimes) and the per-agent artifact markdown.
 *
 * Both backend binaries are stubbed on PATH so the assertion focuses on
 * resolution and dispatch wiring rather than live model behavior.
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

function installClaudeStub(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, "claude");
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const fs = require("node:fs");

if (process.argv[2] === "auth" && process.argv[3] === "status") {
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: "stub" }) + "\\n");
  process.exit(0);
}

const sysIdx = process.argv.indexOf("--system-prompt");
const sys = sysIdx >= 0 ? (process.argv[sysIdx + 1] ?? "") : "";
fs.readFileSync(0, "utf8");
const match = sys.match(/AGENT-NAME:(\\S+)/);
const agent = match ? match[1] : "unknown-claude-agent";
const modelIdx = process.argv.indexOf("--model");
const model = modelIdx >= 0 ? (process.argv[modelIdx + 1] ?? "") : "";

process.stdout.write(JSON.stringify({
  agent,
  round: 1,
  stance: "Adopt",
  recommendation: agent + " dispatched via claude harness model=" + model,
  reasoning: [agent + " reasoned through the claude CLI"],
  objections: [],
  risks: ["mixed-harness shared risk"],
  changesFromPriorRound: [],
  confidence: "high",
  openQuestions: [],
}));
`,
    "utf-8",
  );
  chmodSync(scriptPath, 0o755);
}

function installCodexStub(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, "codex");
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const fs = require("node:fs");

if (process.argv[2] === "login" && process.argv[3] === "status") {
  process.stdout.write("Logged in using ChatGPT\\n");
  process.exit(0);
}

const prompt = fs.readFileSync(0, "utf8");
const match = prompt.match(/AGENT-NAME:(\\S+)/);
const agent = match ? match[1] : "unknown-codex-agent";
const modelIdx = process.argv.indexOf("-m");
const model = modelIdx >= 0 ? (process.argv[modelIdx + 1] ?? "") : "";

process.stdout.write(JSON.stringify({
  agent,
  round: 1,
  stance: "Adopt",
  recommendation: agent + " dispatched via codex harness model=" + model,
  reasoning: [agent + " reasoned through the codex CLI"],
  objections: [],
  risks: ["mixed-harness shared risk"],
  changesFromPriorRound: [],
  confidence: "high",
  openQuestions: [],
}));
`,
    "utf-8",
  );
  chmodSync(scriptPath, 0o755);
}

function installOpenCodeStub(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, "opencode");
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const fs = require("node:fs");

const prompt = fs.readFileSync(0, "utf8");
if (prompt.includes("# Orchestrator Resolution Pass")) {
  const nextRoundMatch = prompt.match(/Round (\\d+)/);
  const nextRound = nextRoundMatch ? Number(nextRoundMatch[1]) : 2;
  process.stdout.write(JSON.stringify({
    round: nextRound,
    directive: "opencode orchestrator directive for round " + nextRound,
    questionResolutions: [],
    questionResolutionLimit: 0,
    deferredQuestions: [],
    confidence: "medium",
  }));
  process.exit(0);
}
const match = prompt.match(/AGENT-NAME:(\\S+)/) || prompt.match(/You are the ([a-z-]+) agent/);
const agent = match ? match[1] : "unknown-opencode-agent";
const modelIdx = process.argv.indexOf("--model");
const model = modelIdx >= 0 ? (process.argv[modelIdx + 1] ?? "") : "";
const round = prompt.includes("Prior Round Packet") ? 2 : 1;

process.stdout.write(JSON.stringify({
  agent,
  round,
  stance: "Adopt",
  recommendation: agent + " dispatched via opencode harness model=" + model,
  reasoning: [agent + " reasoned through the opencode CLI"],
  objections: [],
  risks: ["mixed-harness shared risk"],
  changesFromPriorRound: [],
  confidence: "high",
  openQuestions: [],
}));
`,
    "utf-8",
  );
  chmodSync(scriptPath, 0o755);
}

function installAcliStub(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, "acli");
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const fs = require("node:fs");

const prompt = fs.readFileSync(0, "utf8");
const match = prompt.match(/AGENT-NAME:(\\S+)/);
const agent = match ? match[1] : "unknown-rovo-agent";
const modelIdx = process.argv.indexOf("--model");
const model = modelIdx >= 0 ? (process.argv[modelIdx + 1] ?? "") : "";

process.stdout.write(JSON.stringify({
  agent,
  round: 1,
  stance: "Adopt",
  recommendation: agent + " dispatched via rovo harness model=" + model,
  reasoning: [agent + " reasoned through the acli rovodev CLI"],
  objections: [],
  risks: ["mixed-harness shared risk"],
  changesFromPriorRound: [],
  confidence: "high",
  openQuestions: [],
}));
`,
    "utf-8",
  );
  chmodSync(scriptPath, 0o755);
}

function writeAgent(
  baseDir: string,
  name: string,
  body: Record<string, string>,
): void {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (value.includes("\n")) {
      lines.push(`${key}: |`);
      for (const line of value.split("\n")) {
        lines.push(`  ${line}`);
      }
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  writeFileSync(
    join(baseDir, ".swarm", "agents", `${name}.yml`),
    lines.join("\n") + "\n",
    "utf-8",
  );
}

describe("e2e: mixed-harness swarm run", () => {
  let baseDir: string;
  let binDir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    baseDir = join(tmpdir(), `swarm-mixed-${randomUUID()}`);
    binDir = join(baseDir, "bin");
    mkdirSync(join(baseDir, ".swarm", "agents"), { recursive: true });
    installClaudeStub(binDir);
    installCodexStub(binDir);
    installOpenCodeStub(binDir);
    installAcliStub(binDir);
    originalPath = process.env.PATH;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("dispatches one agent through claude and one through codex in the same round", () => {
    writeAgent(baseDir, "pm-mixed", {
      name: "pm-mixed",
      description: "PM routed via claude harness",
      persona: "AGENT-NAME:pm-mixed You are a rigorous product manager.",
      prompt: "Evaluate the topic and return the swarm JSON contract.",
      harness: "claude",
      model: "claude-sonnet-4-5",
    });
    writeAgent(baseDir, "pe-mixed", {
      name: "pe-mixed",
      description: "PE routed via codex harness",
      persona: "AGENT-NAME:pe-mixed You are a principal engineer.",
      prompt: "Evaluate the topic and return the swarm JSON contract.",
      harness: "codex",
    });

    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "1",
        "Should we adopt mixed-harness swarms",
        "--agents",
        "pm-mixed,pe-mixed",
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
    expect(result.stderr).not.toContain("swarm:");

    const runsDir = join(baseDir, ".swarm", "runs");
    const [entry] = readdirSync(runsDir);
    expect(entry).toBeTruthy();
    const runDir = join(runsDir, entry);

    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );
    expect(manifest.agents).toEqual(["pm-mixed", "pe-mixed"]);
    expect(manifest.agentRuntimes).toEqual([
      {
        agentName: "pm-mixed",
        harness: "claude",
        model: "claude-sonnet-4-5",
        source: { harness: "agent.harness", model: "agent.model" },
      },
      {
        agentName: "pe-mixed",
        harness: "codex",
        model: null,
        source: { harness: "agent.harness", model: "harness-default" },
      },
    ]);

    const pmMd = readFileSync(
      join(runDir, "round-01", "agents", "pm-mixed.md"),
      "utf-8",
    );
    expect(pmMd).toContain("Status: ok");
    expect(pmMd).toContain("Wrapper: claude-cli");
    expect(pmMd).toContain("Harness: claude");
    expect(pmMd).toContain("Model: claude-sonnet-4-5");
    expect(pmMd).toContain(
      "pm-mixed dispatched via claude harness model=claude-sonnet-4-5",
    );

    const peMd = readFileSync(
      join(runDir, "round-01", "agents", "pe-mixed.md"),
      "utf-8",
    );
    expect(peMd).toContain("Status: ok");
    expect(peMd).toContain("Wrapper: codex-cli");
    expect(peMd).toContain("Harness: codex");
    expect(peMd).toContain("Model: harness-default");
    expect(peMd).toContain("pe-mixed dispatched via codex harness model=");
  });

  it("uses agent backends when no run backend is configured", () => {
    writeAgent(baseDir, "pm-backend", {
      name: "pm-backend",
      description: "PM routed via claude backend",
      persona: "AGENT-NAME:pm-backend You are a rigorous product manager.",
      prompt: "Evaluate the topic and return the swarm JSON contract.",
      backend: "claude",
    });
    writeAgent(baseDir, "pe-backend", {
      name: "pe-backend",
      description: "PE routed via codex backend",
      persona: "AGENT-NAME:pe-backend You are a principal engineer.",
      prompt: "Evaluate the topic and return the swarm JSON contract.",
      backend: "codex",
    });

    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "1",
        "Should agent backends select harnesses",
        "--agents",
        "pm-backend,pe-backend",
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
    expect(entry).toBeTruthy();
    const runDir = join(runsDir, entry);

    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );
    expect(manifest.agentRuntimes).toEqual([
      {
        agentName: "pm-backend",
        harness: "claude",
        model: null,
        source: { harness: "agent.backend", model: "harness-default" },
      },
      {
        agentName: "pe-backend",
        harness: "codex",
        model: null,
        source: { harness: "agent.backend", model: "harness-default" },
      },
    ]);

    const peMd = readFileSync(
      join(runDir, "round-01", "agents", "pe-backend.md"),
      "utf-8",
    );
    expect(peMd).toContain("Wrapper: codex-cli");
    expect(peMd).toContain("Harness: codex");
  });

  it("dispatches one agent through opencode and one through rovo in the same round", () => {
    writeAgent(baseDir, "pm-oc", {
      name: "pm-oc",
      description: "PM routed via opencode harness",
      persona: "AGENT-NAME:pm-oc You are a rigorous product manager.",
      prompt: "Evaluate the topic and return the swarm JSON contract.",
      harness: "opencode",
      model: "opencode-sonnet",
    });
    writeAgent(baseDir, "pe-rovo", {
      name: "pe-rovo",
      description: "PE routed via rovo harness",
      persona: "AGENT-NAME:pe-rovo You are a principal engineer.",
      prompt: "Evaluate the topic and return the swarm JSON contract.",
      harness: "rovo",
    });

    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "1",
        "Should we adopt opencode+rovo mixed swarms",
        "--agents",
        "pm-oc,pe-rovo",
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
    expect(entry).toBeTruthy();
    const runDir = join(runsDir, entry);

    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );
    expect(manifest.agents).toEqual(["pm-oc", "pe-rovo"]);
    expect(manifest.agentRuntimes).toEqual([
      {
        agentName: "pm-oc",
        harness: "opencode",
        model: "opencode-sonnet",
        source: { harness: "agent.harness", model: "agent.model" },
      },
      {
        agentName: "pe-rovo",
        harness: "rovo",
        model: null,
        source: { harness: "agent.harness", model: "harness-default" },
      },
    ]);

    const pmMd = readFileSync(
      join(runDir, "round-01", "agents", "pm-oc.md"),
      "utf-8",
    );
    expect(pmMd).toContain("Status: ok");
    expect(pmMd).toContain("Wrapper: opencode-cli");
    expect(pmMd).toContain("Harness: opencode");
    expect(pmMd).toContain("Model: opencode-sonnet");
    expect(pmMd).toContain(
      "pm-oc dispatched via opencode harness model=opencode-sonnet",
    );

    const peMd = readFileSync(
      join(runDir, "round-01", "agents", "pe-rovo.md"),
      "utf-8",
    );
    expect(peMd).toContain("Status: ok");
    expect(peMd).toContain("Wrapper: rovo-acli");
    expect(peMd).toContain("Harness: rovo");
    expect(peMd).toContain("Model: harness-default");
    expect(peMd).toContain("pe-rovo dispatched via rovo harness model=");
  });

  it("runs the bundled OpenCode preset orchestrator through opencode", () => {
    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "2",
        "Should we use the opencode preset",
        "--preset",
        "product-decision-opencode",
      ],
      {
        cwd: baseDir,
        encoding: "utf-8",
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("[run] complete rounds=2");

    const runsDir = join(baseDir, ".swarm", "runs");
    const [entry] = readdirSync(runsDir);
    expect(entry).toBeTruthy();
    const runDir = join(runsDir, entry);
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );

    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.agentRuntimes).toContainEqual({
      agentName: "orchestrator",
      harness: "opencode",
      model: null,
      source: { harness: "agent.harness", model: "harness-default" },
    });
  });
});
