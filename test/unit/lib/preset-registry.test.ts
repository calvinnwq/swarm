import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadPresetRegistry,
  resolvePresetByName,
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

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writePresetFile(
  root: string,
  fileName: string,
  contents: string,
): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, fileName), contents, "utf-8");
}

async function makeIsolatedRoots(): Promise<{
  cwd: string;
  homeDir: string;
  bundledDir: string;
}> {
  const cwd = await makeTempDir("swarm-preset-cwd-");
  const homeDir = await makeTempDir("swarm-preset-home-");
  const bundledDir = await makeTempDir("swarm-preset-bundled-");
  return { cwd, homeDir, bundledDir };
}

describe("loadPresetRegistry", () => {
  it("loads a preset from the project .swarm/presets directory", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });
    const preset = registry.getPreset("product-decision");
    expect(preset.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(preset.resolve).toBe("orchestrator");
  });

  it("returns an empty registry when no preset directories exist", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });
    expect(registry.listPresets()).toEqual([]);
  });

  it("throws a clear error for an unknown preset", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });
    expect(() => registry.getPreset("nope")).toThrow(SwarmCommandError);
    expect(() => registry.getPreset("nope")).toThrow(/unknown preset "nope"/);
  });

  it("prefers project-local over home and bundled roots", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    const sharedName = "dup";
    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "dup.yml",
      `name: ${sharedName}\nagents: [from-project, pm]`,
    );
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "dup.yml",
      `name: ${sharedName}\nagents: [from-home, pm]`,
    );
    await writePresetFile(
      bundledDir,
      "dup.yml",
      `name: ${sharedName}\nagents: [from-bundled, pm]`,
    );

    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });
    const preset = registry.getPreset("dup");
    expect(preset.agents).toContain("from-project");
    expect(preset.agents).not.toContain("from-home");
    expect(preset.agents).not.toContain("from-bundled");
  });

  it("rejects invalid preset YAML with actionable error", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "bad.yml",
      "name: bad\nagents: [solo]",
    );
    await expect(
      loadPresetRegistry({ cwd, homeDir, bundledDir }),
    ).rejects.toThrow(/invalid preset/);
  });

  it("throws on duplicate preset names within the same root", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    const root = path.join(cwd, ".swarm", "presets");
    await writePresetFile(root, "a.yml", "name: same\nagents: [alpha, beta]");
    await writePresetFile(root, "b.yml", "name: same\nagents: [alpha, beta]");
    await expect(
      loadPresetRegistry({ cwd, homeDir, bundledDir }),
    ).rejects.toThrow(/duplicate preset "same"/);
  });

  it("falls back to home when project root is missing the preset", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "home-preset.yml",
      "name: home-preset\nagents: [pm, eng]",
    );
    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });
    expect(registry.getPreset("home-preset").agents).toEqual(["pm", "eng"]);
  });

  it("loads presets from bundled directory when requested", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      bundledDir,
      "bundled.yml",
      "name: bundled\nagents: [alpha, beta]",
    );
    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });
    expect(registry.getPreset("bundled").agents).toEqual(["alpha", "beta"]);
  });

  it("trims and lowercases the lookup name", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "mine.yml",
      "name: mine\nagents: [a, b]",
    );
    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });
    expect(registry.getPreset("  MINE  ").agents).toEqual(["a", "b"]);
  });

  it("loads the bundled product-decision preset from the default bundled directory", async () => {
    const cwd = await makeTempDir("swarm-preset-cwd-");
    const homeDir = await makeTempDir("swarm-preset-home-");

    const registry = await loadPresetRegistry({ cwd, homeDir });
    const preset = registry.getPreset("product-decision");
    expect(preset.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(preset.resolve).toBe("orchestrator");
    expect(preset.goal).toMatch(/decision-ready/i);
  });

  it("rejects preset names with uppercase letters", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "bad.yml",
      "name: BadName\nagents: [a, b]",
    );
    await expect(
      loadPresetRegistry({ cwd, homeDir, bundledDir }),
    ).rejects.toThrow(/invalid preset/);
  });
});

describe("resolvePresetByName", () => {
  it("prefers project-local presets over home and bundled roots", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    const presetName = "product-decision";

    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.yml",
      [
        `name: ${presetName}`,
        "agents:",
        "  - from-project",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.yml",
      [
        `name: ${presetName}`,
        "agents:",
        "  - from-home",
        "  - principal-engineer",
        "resolve: off",
      ].join("\n"),
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      [
        `name: ${presetName}`,
        "agents:",
        "  - from-bundled",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName(presetName, {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["from-project", "principal-engineer"]);
    expect(preset.resolve).toBe("agents");
  });

  it("resolves the requested preset while ignoring unrelated invalid preset files", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "broken-preset.yml",
      "name: broken-preset\nagents: [solo]",
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(preset.resolve).toBe("orchestrator");
  });

  it("resolves the requested preset while ignoring unrelated invalid home preset files", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "broken-preset.yml",
      "name: broken-preset\nagents: [solo]",
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(preset.resolve).toBe("orchestrator");
  });
});
