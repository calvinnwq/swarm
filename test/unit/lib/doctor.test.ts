import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatDoctorReport, runDoctor } from "../../../src/lib/index.js";

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
  binDir: string;
  env: NodeJS.ProcessEnv;
}> {
  const cwd = await makeTempDir("swarm-doctor-cwd-");
  const homeDir = await makeTempDir("swarm-doctor-home-");
  const bundledAgentsDir = await makeTempDir("swarm-doctor-agents-");
  const bundledPresetsDir = await makeTempDir("swarm-doctor-presets-");
  const binDir = await makeTempDir("swarm-doctor-bin-");
  return {
    cwd,
    homeDir,
    bundledAgentsDir,
    bundledPresetsDir,
    binDir,
    env: { PATH: binDir },
  };
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

async function installLoggedInClaudeStub(binDir: string): Promise<void> {
  const filePath = path.join(binDir, "claude");
  await writeFile(
    filePath,
    [
      `#!${process.execPath}`,
      'if (process.argv[2] === "auth" && process.argv[3] === "status") {',
      '  process.stdout.write(JSON.stringify({ loggedIn: true }) + "\\n");',
      "  process.exit(0);",
      "}",
      'process.stderr.write("unexpected claude invocation\\n");',
      "process.exit(1);",
      "",
    ].join("\n"),
    "utf-8",
  );
  await chmod(filePath, 0o755);
}

function agentYaml(name: string): string {
  return [
    `name: ${name}`,
    "description: test agent",
    "persona: test persona",
    "prompt: test prompt body",
  ].join("\n");
}

describe("runDoctor", () => {
  it("reports OK when there is no project config and registries load cleanly", async () => {
    const roots = await makeIsolatedRoots();
    await installLoggedInClaudeStub(roots.binDir);
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
    expect(report.ok).toBe(true);
    const names = report.checks.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "project config",
        "agent registry",
        "preset registry",
      ]),
    );
    const config = report.checks.find((c) => c.name === "project config");
    expect(config?.status).toBe("ok");
    expect(config?.message).toContain("no .swarm/config.yml");
    expect(
      report.checks.find((c) => c.name === "harness capability"),
    ).toBeUndefined();
  });

  it("reports FAIL when both registries are empty", async () => {
    const roots = await makeIsolatedRoots();
    await installLoggedInClaudeStub(roots.binDir);
    const report = await runDoctor(roots);
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "agent registry")?.status).toBe(
      "fail",
    );
    expect(
      report.checks.find((c) => c.name === "preset registry")?.status,
    ).toBe("fail");
    expect(
      report.checks.find((c) => c.name === "harness capability"),
    ).toBeUndefined();
  });

  it("reports FAIL when config references an unknown agent", async () => {
    const roots = await makeIsolatedRoots();
    await installLoggedInClaudeStub(roots.binDir);
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
      ["agents:", "  - product-manager", "  - ghost-agent"].join("\n"),
    );

    const report = await runDoctor(roots);
    expect(report.ok).toBe(false);
    const check = report.checks.find((c) => c.name === "config agents");
    expect(check?.status).toBe("fail");
    expect(check?.message).toContain("ghost-agent");
  });

  it("reports FAIL when config references an unknown preset", async () => {
    const roots = await makeIsolatedRoots();
    await installLoggedInClaudeStub(roots.binDir);
    await writeFileUnder(roots.cwd, ".swarm/config.yml", "preset: nope\n");
    const report = await runDoctor(roots);
    expect(report.ok).toBe(false);
    const check = report.checks.find((c) => c.name === "config preset");
    expect(check?.status).toBe("fail");
    expect(check?.message).toContain("unknown preset");
    expect(
      report.checks.find((c) => c.name === "harness capability")?.status,
    ).toBe("ok");
  });

  it("reports FAIL with an actionable message when config YAML is invalid", async () => {
    const roots = await makeIsolatedRoots();
    await writeFileUnder(roots.cwd, ".swarm/config.yml", "rounds: 9\n");
    const report = await runDoctor(roots);
    expect(report.ok).toBe(false);
    const check = report.checks.find((c) => c.name === "project config");
    expect(check?.status).toBe("fail");
    expect(check?.message).toContain("invalid .swarm/config.yml");
    expect(check?.message).toContain("rounds");
    expect(
      report.checks.find((c) => c.name === "harness capability"),
    ).toBeUndefined();
  });

  it("reports FAIL when config docs reference a missing carry-forward path", async () => {
    const roots = await makeIsolatedRoots();
    await installLoggedInClaudeStub(roots.binDir);
    await writeFileUnder(
      roots.bundledAgentsDir,
      "product-manager.yml",
      agentYaml("product-manager"),
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
    await writeFileUnder(
      roots.cwd,
      ".swarm/config.yml",
      ["docs:", "  - docs/missing.md"].join("\n"),
    );

    const report = await runDoctor(roots);

    expect(report.ok).toBe(false);
    const check = report.checks.find((c) => c.name === "config docs");
    expect(check?.status).toBe("fail");
    expect(check?.message).toContain(
      "carry-forward doc not found: docs/missing.md",
    );
  });

  it("reports OK when config preset resolves and its agents exist", async () => {
    const roots = await makeIsolatedRoots();
    await installLoggedInClaudeStub(roots.binDir);
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
      roots.bundledPresetsDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );
    await writeFileUnder(
      roots.cwd,
      ".swarm/config.yml",
      "preset: product-decision\n",
    );

    const report = await runDoctor(roots);
    expect(report.ok).toBe(true);
    const check = report.checks.find((c) => c.name === "config preset");
    expect(check?.status).toBe("ok");
    expect(check?.message).toContain("product-decision");
    expect(
      report.checks.find((c) => c.name === "harness capability")?.status,
    ).toBe("ok");
  });

  it("skips preset validation when explicit config agents are present", async () => {
    const roots = await makeIsolatedRoots();
    await installLoggedInClaudeStub(roots.binDir);
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
      roots.bundledPresetsDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - missing-agent",
        "  - another-missing-agent",
        "resolve: orchestrator",
      ].join("\n"),
    );
    await writeFileUnder(
      roots.cwd,
      ".swarm/config.yml",
      [
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "preset: product-decision",
      ].join("\n"),
    );

    const report = await runDoctor(roots);
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "config agents")?.status).toBe(
      "ok",
    );
    expect(
      report.checks.find((c) => c.name === "config preset"),
    ).toBeUndefined();
    expect(
      report.checks.find((c) => c.name === "harness capability")?.status,
    ).toBe("ok");
  });
});

describe("formatDoctorReport", () => {
  it("prints OK/FAIL markers and a summary line", () => {
    const text = formatDoctorReport({
      ok: false,
      checks: [
        { name: "a", status: "ok", message: "fine" },
        { name: "b", status: "fail", message: "broken", detail: "line1" },
      ],
    });
    expect(text).toContain("[OK] a: fine");
    expect(text).toContain("[FAIL] b: broken");
    expect(text).toContain("swarm doctor: problems found");
  });

  it("prints the ready summary when all checks pass", () => {
    const text = formatDoctorReport({
      ok: true,
      checks: [{ name: "a", status: "ok", message: "fine" }],
    });
    expect(text).toContain("swarm doctor: ready");
  });
});
