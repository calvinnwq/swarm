import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDoctor } from "../../../src/lib/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeIsolatedRoots(): Promise<{
  cwd: string;
  homeDir: string;
  bundledAgentsDir: string;
  bundledPresetsDir: string;
}> {
  const cwd = await makeTempDir("swarm-doctor-backend-cwd-");
  const homeDir = await makeTempDir("swarm-doctor-backend-home-");
  const bundledAgentsDir = await makeTempDir("swarm-doctor-backend-agents-");
  const bundledPresetsDir = await makeTempDir("swarm-doctor-backend-presets-");
  return { cwd, homeDir, bundledAgentsDir, bundledPresetsDir };
}

async function writeFileUnder(
  root: string,
  relative: string,
  contents: string,
): Promise<void> {
  const filePath = path.join(root, relative);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf-8");
}

function agentYaml(name: string, backend = "claude"): string {
  return [
    `name: ${name}`,
    "description: test agent",
    "persona: test persona",
    "prompt: test prompt body",
    `backend: ${backend}`,
  ].join("\n");
}

describe("runDoctor backend checks", () => {
  it("reports backend selection as healthy when config backend matches resolved agents", async () => {
    const roots = await makeIsolatedRoots();
    await writeFileUnder(
      roots.bundledAgentsDir,
      "product-manager.yml",
      agentYaml("product-manager"),
    );
    await writeFileUnder(
      roots.bundledAgentsDir,
      "principal-engineer.yml",
      agentYaml("principal-engineer"),
    );
    await writeFileUnder(
      roots.cwd,
      ".swarm/config.yml",
      [
        "backend: claude",
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
      ].join("\n"),
    );
    await writeFileUnder(
      roots.bundledPresetsDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
      ].join("\n"),
    );

    const report = await runDoctor(roots);

    const check = report.checks.find(
      (entry) => entry.name === "config backend",
    );
    expect(check?.status).toBe("ok");
    expect(check?.message).toContain("claude");
    expect(report.ok).toBe(true);
  });

  it("reports Codex backend selection as healthy when the preset resolves to Codex agents", async () => {
    const roots = await makeIsolatedRoots();
    await writeFileUnder(
      roots.bundledAgentsDir,
      "product-manager-codex.yml",
      agentYaml("product-manager-codex", "codex"),
    );
    await writeFileUnder(
      roots.bundledAgentsDir,
      "principal-engineer-codex.yml",
      agentYaml("principal-engineer-codex", "codex"),
    );
    await writeFileUnder(
      roots.cwd,
      ".swarm/config.yml",
      ["backend: codex", "preset: product-decision-codex"].join("\n"),
    );
    await writeFileUnder(
      roots.bundledPresetsDir,
      "product-decision-codex.yml",
      [
        "name: product-decision-codex",
        "agents:",
        "  - product-manager-codex",
        "  - principal-engineer-codex",
      ].join("\n"),
    );

    const report = await runDoctor(roots);

    const check = report.checks.find(
      (entry) => entry.name === "config backend",
    );
    expect(check?.status).toBe("ok");
    expect(check?.message).toContain('backend "codex" matches preset');
    expect(report.ok).toBe(true);
  });

  it("reports an actionable mismatch when config backend and preset agent backends disagree", async () => {
    const roots = await makeIsolatedRoots();
    await writeFileUnder(
      roots.bundledAgentsDir,
      "product-manager.yml",
      agentYaml("product-manager", "claude"),
    );
    await writeFileUnder(
      roots.bundledAgentsDir,
      "principal-engineer.yml",
      agentYaml("principal-engineer", "claude"),
    );
    await writeFileUnder(
      roots.cwd,
      ".swarm/config.yml",
      ["backend: codex", "preset: product-decision"].join("\n"),
    );
    await writeFileUnder(
      roots.bundledPresetsDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
      ].join("\n"),
    );

    const report = await runDoctor(roots);

    const check = report.checks.find(
      (entry) => entry.name === "config backend",
    );
    expect(check?.status).toBe("fail");
    expect(check?.message).toContain("product-manager (claude)");
    expect(report.ok).toBe(false);
  });
});
