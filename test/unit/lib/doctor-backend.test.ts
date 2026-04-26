import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  binDir: string;
  env: NodeJS.ProcessEnv;
}> {
  const cwd = await makeTempDir("swarm-doctor-backend-cwd-");
  const homeDir = await makeTempDir("swarm-doctor-backend-home-");
  const bundledAgentsDir = await makeTempDir("swarm-doctor-backend-agents-");
  const bundledPresetsDir = await makeTempDir("swarm-doctor-backend-presets-");
  const binDir = await makeTempDir("swarm-doctor-backend-bin-");
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

async function writeExecutable(
  root: string,
  name: string,
  lines: string[],
): Promise<void> {
  const filePath = path.join(root, name);
  await writeFile(
    filePath,
    [`#!${process.execPath}`, ...lines, ""].join("\n"),
    "utf-8",
  );
  await chmod(filePath, 0o755);
}

async function installClaudeAuthStub(
  binDir: string,
  options: { loggedIn: boolean } = { loggedIn: true },
): Promise<void> {
  await writeExecutable(binDir, "claude", [
    'if (process.argv[2] === "auth" && process.argv[3] === "status") {',
    `  process.stdout.write(JSON.stringify({ loggedIn: ${options.loggedIn} }) + "\\n");`,
    "  process.exit(0);",
    "}",
    'process.stderr.write("unexpected claude invocation\\n");',
    "process.exit(1);",
  ]);
}

async function installCodexLoginStub(
  binDir: string,
  options: {
    output?: string;
    exitCode?: number;
    execExitCode?: number;
    execStdout?: string;
    execStderr?: string;
  } = {},
): Promise<void> {
  const output = JSON.stringify(
    options.output ?? "Authenticated via API key\n",
  );
  const exitCode = options.exitCode ?? 0;
  const execExitCode = options.execExitCode ?? 0;
  const execStdout = JSON.stringify(
    options.execStdout ?? "Usage: codex exec [options]\n",
  );
  const execStderr = JSON.stringify(options.execStderr ?? "");
  await writeExecutable(binDir, "codex", [
    'if (process.argv[2] === "login" && process.argv[3] === "status") {',
    `  process.stdout.write(${output});`,
    `  process.exit(${exitCode});`,
    "}",
    'if (process.argv[2] === "exec" && process.argv.includes("--help")) {',
    `  process.stdout.write(${execStdout});`,
    `  process.stderr.write(${execStderr});`,
    `  process.exit(${execExitCode});`,
    "}",
    'process.stderr.write("unexpected codex invocation\\n");',
    "process.exit(1);",
  ]);
}

async function installOpenCodeAuthStub(binDir: string): Promise<void> {
  await writeExecutable(binDir, "opencode", [
    'if (process.argv[2] === "auth" && process.argv[3] === "list") {',
    '  process.stdout.write("github\\n");',
    "  process.exit(0);",
    "}",
    'if (process.argv[2] === "run" && process.argv[3] === "--help") {',
    '  process.stdout.write("Usage: opencode run\\n");',
    "  process.exit(0);",
    "}",
    'process.stderr.write("unexpected opencode invocation\\n");',
    "process.exit(1);",
  ]);
}

function agentYaml(
  name: string,
  options: { backend?: string; harness?: string } = {},
): string {
  const lines = [
    `name: ${name}`,
    "description: test agent",
    "persona: test persona",
    "prompt: test prompt body",
    `backend: ${options.backend ?? "claude"}`,
  ];
  if (options.harness) {
    lines.push(`harness: ${options.harness}`);
  }
  return lines.join("\n");
}

describe("runDoctor backend checks", () => {
  it("reports backend selection as healthy when config backend matches resolved agents", async () => {
    const roots = await makeIsolatedRoots();
    await installClaudeAuthStub(roots.binDir);
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
    const capability = report.checks.find(
      (entry) => entry.name === "harness capability",
    );
    expect(check?.status).toBe("ok");
    expect(check?.message).toContain("claude");
    expect(capability?.status).toBe("ok");
    expect(capability?.message).toContain("installed and authenticated");
    expect(capability?.message).toContain('harness "claude"');
    expect(report.ok).toBe(true);
  });

  it("probes each harness requested by configured agents", async () => {
    const roots = await makeIsolatedRoots();
    await installClaudeAuthStub(roots.binDir);
    await installOpenCodeAuthStub(roots.binDir);
    await writeFileUnder(
      roots.bundledAgentsDir,
      "product-manager.yml",
      agentYaml("product-manager"),
    );
    await writeFileUnder(
      roots.bundledAgentsDir,
      "principal-engineer-opencode.yml",
      agentYaml("principal-engineer-opencode", { harness: "opencode" }),
    );
    await writeFileUnder(
      roots.cwd,
      ".swarm/config.yml",
      [
        "backend: claude",
        "agents:",
        "  - product-manager",
        "  - principal-engineer-opencode",
      ].join("\n"),
    );
    await writeFileUnder(
      roots.bundledPresetsDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - product-manager",
        "  - principal-engineer-opencode",
      ].join("\n"),
    );

    const report = await runDoctor(roots);

    const capabilities = report.checks.filter(
      (entry) => entry.name === "harness capability",
    );
    expect(capabilities.map((entry) => entry.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('harness "claude"'),
        expect.stringContaining('harness "opencode"'),
      ]),
    );
    expect(report.ok).toBe(true);
  });

  it("reports Codex backend selection as healthy when the preset resolves to Codex agents", async () => {
    const roots = await makeIsolatedRoots();
    await installCodexLoginStub(roots.binDir);
    await writeFileUnder(
      roots.bundledAgentsDir,
      "product-manager-codex.yml",
      agentYaml("product-manager-codex", { backend: "codex" }),
    );
    await writeFileUnder(
      roots.bundledAgentsDir,
      "principal-engineer-codex.yml",
      agentYaml("principal-engineer-codex", { backend: "codex" }),
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
    const capability = report.checks.find(
      (entry) => entry.name === "harness capability",
    );
    expect(check?.status).toBe("ok");
    expect(check?.message).toContain('backend "codex" matches preset');
    expect(capability?.status).toBe("ok");
    expect(capability?.message).toContain('harness "codex"');
    expect(report.ok).toBe(true);
  });

  it("fails when Codex is logged in but lacks exec runtime support", async () => {
    const roots = await makeIsolatedRoots();
    await installCodexLoginStub(roots.binDir, {
      execExitCode: 64,
      execStderr: "unknown option: --sandbox\n",
    });
    await writeFileUnder(
      roots.bundledAgentsDir,
      "product-manager-codex.yml",
      agentYaml("product-manager-codex", { backend: "codex" }),
    );
    await writeFileUnder(
      roots.bundledAgentsDir,
      "principal-engineer-codex.yml",
      agentYaml("principal-engineer-codex", { backend: "codex" }),
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

    const capability = report.checks.find(
      (entry) => entry.name === "harness capability",
    );
    expect(capability?.status).toBe("fail");
    expect(capability?.message).toContain(
      "missing required `codex exec` support",
    );
    expect(capability?.detail).toContain("unknown option: --sandbox");
    expect(report.ok).toBe(false);
  });

  it("reports an actionable mismatch when config backend and preset agent backends disagree", async () => {
    const roots = await makeIsolatedRoots();
    await writeFileUnder(
      roots.bundledAgentsDir,
      "product-manager.yml",
      agentYaml("product-manager", { backend: "claude" }),
    );
    await writeFileUnder(
      roots.bundledAgentsDir,
      "principal-engineer.yml",
      agentYaml("principal-engineer", { backend: "claude" }),
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
    const capability = report.checks.find(
      (entry) => entry.name === "harness capability",
    );
    expect(check?.status).toBe("fail");
    expect(check?.message).toContain("product-manager (claude)");
    expect(capability?.status).toBe("fail");
    expect(capability?.message).toContain("install the Codex CLI");
    expect(report.ok).toBe(false);
  });

  it("skips harness capability checks when there is no config", async () => {
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

    const capability = report.checks.find(
      (entry) => entry.name === "harness capability",
    );
    expect(capability).toBeUndefined();
    expect(report.ok).toBe(true);
  });

  it("does not fail harness capability when no config backend is available", async () => {
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

    const capability = report.checks.find(
      (entry) => entry.name === "harness capability",
    );
    expect(capability).toBeUndefined();
    expect(report.ok).toBe(true);
  });

  it("fails with login guidance when the backend CLI is present but logged out", async () => {
    const roots = await makeIsolatedRoots();
    await installClaudeAuthStub(roots.binDir, { loggedIn: false });
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

    const capability = report.checks.find(
      (entry) => entry.name === "harness capability",
    );
    expect(capability?.status).toBe("fail");
    expect(capability?.message).toContain("claude auth login");
    expect(report.ok).toBe(false);
  });
});
