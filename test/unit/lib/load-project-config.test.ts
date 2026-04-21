import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadProjectConfig,
  PROJECT_CONFIG_RELATIVE_PATH,
  SwarmCommandError,
} from "../../../src/lib/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempCwd(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "swarm-project-config-"));
  tempDirs.push(dir);
  return dir;
}

async function writeConfig(cwd: string, contents: string): Promise<string> {
  const configDir = path.join(cwd, ".swarm");
  await mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, "config.yml");
  await writeFile(configPath, contents, "utf-8");
  return configPath;
}

describe("loadProjectConfig", () => {
  it("returns null when .swarm/config.yml does not exist", async () => {
    const cwd = await makeTempCwd();
    await expect(loadProjectConfig({ cwd })).resolves.toBeNull();
  });

  it("loads and validates a valid config", async () => {
    const cwd = await makeTempCwd();
    const configPath = await writeConfig(
      cwd,
      [
        "preset: product-decision",
        "resolve: orchestrator",
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "goal: ship the slice",
      ].join("\n"),
    );
    const result = await loadProjectConfig({ cwd });
    expect(result).not.toBeNull();
    expect(result?.filePath).toBe(configPath);
    expect(result?.config).toEqual({
      preset: "product-decision",
      resolve: "orchestrator",
      agents: ["product-manager", "principal-engineer"],
      goal: "ship the slice",
    });
  });

  it("treats an empty config file as empty config object", async () => {
    const cwd = await makeTempCwd();
    await writeConfig(cwd, "");
    const result = await loadProjectConfig({ cwd });
    expect(result?.config).toEqual({});
  });

  it("throws a SwarmCommandError with actionable message on invalid YAML", async () => {
    const cwd = await makeTempCwd();
    await writeConfig(cwd, "agents:\n  - a\n -b\n");
    await expect(loadProjectConfig({ cwd })).rejects.toThrow(SwarmCommandError);
    await expect(loadProjectConfig({ cwd })).rejects.toThrow(
      /invalid YAML in \.swarm\/config\.yml/,
    );
  });

  it("throws with path-qualified messages on schema violations", async () => {
    const cwd = await makeTempCwd();
    await writeConfig(cwd, ["resolve: majority"].join("\n"));
    await expect(loadProjectConfig({ cwd })).rejects.toThrowError(
      /invalid \.swarm\/config\.yml/,
    );
    await expect(loadProjectConfig({ cwd })).rejects.toThrowError(/resolve/);
  });

  it("rejects unknown top-level keys (strict)", async () => {
    const cwd = await makeTempCwd();
    await writeConfig(cwd, "totally_unknown: yes\n");
    await expect(loadProjectConfig({ cwd })).rejects.toThrow(/totally_unknown/);
  });

  it("exposes the relative path constant", () => {
    expect(PROJECT_CONFIG_RELATIVE_PATH).toBe(".swarm/config.yml");
  });
});
