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

process.stdout.write(JSON.stringify({
  agent,
  round: 1,
  stance: "Adopt",
  recommendation: agent + " dispatched via claude harness",
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

process.stdout.write(JSON.stringify({
  agent,
  round: 1,
  stance: "Adopt",
  recommendation: agent + " dispatched via codex harness",
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
    expect(pmMd).toContain("Harness: claude");
    expect(pmMd).toContain("Model: claude-sonnet-4-5");
    expect(pmMd).toContain("pm-mixed dispatched via claude harness");

    const peMd = readFileSync(
      join(runDir, "round-01", "agents", "pe-mixed.md"),
      "utf-8",
    );
    expect(peMd).toContain("Status: ok");
    expect(peMd).toContain("Harness: codex");
    expect(peMd).toContain("Model: harness-default");
    expect(peMd).toContain("pe-mixed dispatched via codex harness");
  });
});
