import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../../dist/cli.mjs", import.meta.url));

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("node", [cliPath, ...args], { encoding: "utf-8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
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

  it("runs a valid command and exits 0", () => {
    const { status, stderr } = runCli([
      "run",
      "2",
      "sample",
      "topic",
      "--agents",
      "product-manager,orchestrator",
      "--resolve",
      "orchestrator",
    ]);
    expect(status).toBe(0);
    expect(stderr).toContain("topic=\"sample topic\"");
    expect(stderr).toContain("rounds=2");
    expect(stderr).toContain("agents=product-manager,orchestrator");
    expect(stderr).toContain("resolve=orchestrator");
  });

  it("runs with bundled default agents and exits 0", () => {
    const { status, stderr } = runCli([
      "run",
      "1",
      "hi",
      "--agents",
      "product-manager,principal-engineer",
    ]);
    expect(status).toBe(0);
    expect(stderr).toContain("agents=product-manager,principal-engineer");
  });

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

  it("fails when an agent definition cannot be resolved", () => {
    const { status, stderr } = runCli([
      "run",
      "1",
      "sample",
      "topic",
      "--agents",
      "product-manager,missing-agent",
    ]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/missing-agent/);
    expect(stderr).toMatch(/searched/i);
  });
});
