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

function installCodexStub(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, "codex");
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

if (process.argv[2] === "login" && process.argv[3] === "status") {
  process.stdout.write("Logged in using ChatGPT\\n");
  process.exit(0);
}

if (process.argv[2] === "exec" && process.argv.includes("--help")) {
  process.stdout.write("Usage: codex exec [options]\\n");
  process.exit(0);
}

const prompt = fs.readFileSync(0, "utf8");
const statePath = path.join(path.dirname(process.argv[1]), ".codex-state.json");

let counters = {};
try {
  counters = JSON.parse(fs.readFileSync(statePath, "utf8"));
} catch {}

const agent = /product manager/i.test(prompt)
  ? "product-manager-codex"
  : /principal engineer/i.test(prompt)
    ? "principal-engineer-codex"
    : "unknown-agent";
const round = (counters[agent] ?? 0) + 1;
counters[agent] = round;
fs.writeFileSync(statePath, JSON.stringify(counters));

process.stdout.write(
  JSON.stringify({
    agent,
    round,
    stance: "Adopt",
    recommendation: agent + " recommends Codex in round " + round,
    reasoning: [agent + " reasoning for round " + round],
    objections: [],
    risks: ["shared codex risk"],
    changesFromPriorRound:
      round > 1 ? [agent + " refined stance in round " + round] : [],
    confidence: "high",
    openQuestions: prompt.includes("Prior Round Packet")
      ? ["Confirm Codex rollout sequencing"]
      : [],
  }),
);
`,
    "utf-8",
  );
  chmodSync(scriptPath, 0o755);
}

describe("e2e: codex backend", () => {
  let baseDir: string;
  let binDir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    baseDir = join(tmpdir(), `swarm-codex-${randomUUID()}`);
    binDir = join(baseDir, "bin");
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

  it("runs the bundled Codex preset end to end through the built CLI", () => {
    const result = spawnSync(
      "node",
      [
        cliPath,
        "run",
        "2",
        "Should",
        "we",
        "adopt",
        "Codex",
        "--preset",
        "product-decision-codex",
        "--backend",
        "codex",
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
    expect(result.stderr).toContain("[run] complete rounds=2");
    expect(result.stderr).not.toContain("swarm:");

    const runDir = join(baseDir, ".swarm", "runs");
    const [entry] = existsSync(runDir) ? readdirSync(runDir) : [];
    expect(entry).toBeTruthy();

    const fullRunDir = join(runDir, entry);
    const manifest = JSON.parse(
      readFileSync(join(fullRunDir, "manifest.json"), "utf-8"),
    );
    expect(manifest.backend).toBe("codex");
    expect(manifest.agents).toEqual([
      "product-manager-codex",
      "principal-engineer-codex",
    ]);

    const agentMarkdown = readFileSync(
      join(fullRunDir, "round-01", "agents", "product-manager-codex.md"),
      "utf-8",
    );
    expect(agentMarkdown).toContain("Wrapper: codex-cli");
    expect(agentMarkdown).toContain("product-manager-codex recommends Codex");

    const synthesis = JSON.parse(
      readFileSync(join(fullRunDir, "synthesis.json"), "utf-8"),
    );
    expect(synthesis.topic).toBe("Should we adopt Codex");
    expect(synthesis.sharedRisks).toContain("shared codex risk");
  });

  it("reports ready for a configured Codex backend when the CLI is installed and authenticated", () => {
    mkdirSync(join(baseDir, ".swarm"), { recursive: true });
    writeFileSync(
      join(baseDir, ".swarm", "config.yml"),
      ["backend: codex", "preset: product-decision-codex"].join("\n"),
      "utf-8",
    );

    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: baseDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("swarm doctor: ready");
    expect(result.stdout).toContain("[OK] config backend");
    expect(result.stdout).toContain(
      'backend "codex" matches preset "product-decision-codex" (2 agent(s))',
    );
    expect(result.stdout).toContain("[OK] harness capability");
    expect(result.stdout).toContain(
      'harness "codex" is installed and authenticated',
    );
    expect(result.stderr).toBe("");
  });
});
