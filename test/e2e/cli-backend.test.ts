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

describe("swarm cli backend selection", () => {
  it("documents the backend flag in help output", () => {
    const { status, stdout } = runCli(["run", "--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("--backend <name>");
    expect(stdout).toContain("claude, codex");
  });

  it("fails with a clear invalid-backend error", () => {
    const { status, stderr } = runCli([
      "run",
      "1",
      "sample",
      "topic",
      "--agents",
      "alpha,beta",
      "--backend",
      "openai",
    ]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/invalid --backend/i);
  });
});
