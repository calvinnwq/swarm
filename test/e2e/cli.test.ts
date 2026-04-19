import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../../dist/cli.mjs", import.meta.url));

function runCli(args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("node", [cliPath, ...args], { encoding: "utf-8" });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("swarm cli", () => {
  it("prints help and exits 0", () => {
    const { status, stdout } = runCli(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("swarm");
  });

  it("prints version", () => {
    const { status, stdout } = runCli(["--version"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  // Note: the "run" command now dispatches to the real claude binary,
  // so a full CLI integration test requires CLAUDE_CLI=1.
  // The programmatic e2e test (e2e.test.ts) covers the full pipeline
  // with a mock backend instead.

  it("fails when agents flag is missing", () => {
    const { status, stderr } = runCli(["run", "1", "sample", "topic"]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/agents/);
  });

  it("fails when rounds is out of range", () => {
    const { status, stderr } = runCli([
      "run",
      "5",
      "sample",
      "topic",
      "--agents",
      "alpha,beta",
    ]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/rounds/);
  });

  it("fails when topic is missing", () => {
    const { status, stderr } = runCli(["run", "1", "--agents", "alpha,beta"]);
    expect(status).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
  });
});
