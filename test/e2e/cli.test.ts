import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../../dist/cli.mjs", import.meta.url));

describe("swarm cli", () => {
  it("prints help and exits 0", () => {
    const result = spawnSync("node", [cliPath, "--help"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("swarm");
  });

  it("prints version", () => {
    const result = spawnSync("node", [cliPath, "--version"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
