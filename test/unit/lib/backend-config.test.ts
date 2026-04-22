import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildConfig,
  loadProjectConfig,
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
  const dir = await mkdtemp(path.join(tmpdir(), "swarm-backend-config-"));
  tempDirs.push(dir);
  return dir;
}

async function writeConfig(cwd: string, contents: string): Promise<void> {
  const configDir = path.join(cwd, ".swarm");
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, "config.yml"), contents, "utf-8");
}

describe("backend config support", () => {
  it("loads backend from project config", async () => {
    const cwd = await makeTempCwd();
    await writeConfig(
      cwd,
      ["backend: claude", "agents:", "  - product-manager", "  - principal-engineer"].join("\n"),
    );

    const loaded = await loadProjectConfig({ cwd });

    expect(loaded?.config).toMatchObject({
      backend: "claude",
      agents: ["product-manager", "principal-engineer"],
    });
  });

  it("rejects unknown backend in project config", async () => {
    const cwd = await makeTempCwd();
    await writeConfig(cwd, "backend: openai\n");

    await expect(loadProjectConfig({ cwd })).rejects.toThrow(SwarmCommandError);
    await expect(loadProjectConfig({ cwd })).rejects.toThrow(/backend/);
  });

  it("defaults buildConfig backend to claude", () => {
    const config = buildConfig({
      rounds: 1,
      topic: ["sample"],
      agents: "alpha,beta",
    });

    expect(config.backend).toBe("claude");
  });

  it("normalizes and preserves an explicit backend choice", () => {
    const config = buildConfig({
      rounds: 1,
      topic: ["sample"],
      agents: "alpha,beta",
      backend: " Claude ",
    });

    expect(config.backend).toBe("claude");
  });

  it("rejects invalid backend flags", () => {
    expect(() =>
      buildConfig({
        rounds: 1,
        topic: ["sample"],
        agents: "alpha,beta",
        backend: "openai",
      }),
    ).toThrow(SwarmCommandError);
  });
});
