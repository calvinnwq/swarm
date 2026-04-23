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

  it("rejects malformed project preset YAML with a parse error", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "bad.yml",
      "name: bad\nagents: [unterminated",
    );

    await expect(
      loadPresetRegistry({ cwd, homeDir, bundledDir }),
    ).rejects.toThrow(/failed to parse YAML/);
  });

  it("rejects invalid home preset YAML with actionable error", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "bad.yml",
      "name: bad\nagents: [solo]",
    );

    await expect(
      loadPresetRegistry({ cwd, homeDir, bundledDir }),
    ).rejects.toThrow(/invalid preset/);
  });

  it("rejects malformed home preset YAML with a parse error", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "bad.yml",
      "name: bad\nagents: [unterminated",
    );

    await expect(
      loadPresetRegistry({ cwd, homeDir, bundledDir }),
    ).rejects.toThrow(/failed to parse YAML/);
  });

  it("rejects invalid bundled preset YAML with actionable error", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(bundledDir, "bad.yml", "name: bad\nagents: [solo]");

    await expect(
      loadPresetRegistry({ cwd, homeDir, bundledDir }),
    ).rejects.toThrow(/invalid preset/);
  });

  it("rejects malformed bundled preset YAML with a parse error", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      bundledDir,
      "bad.yml",
      "name: bad\nagents: [unterminated",
    );

    await expect(
      loadPresetRegistry({ cwd, homeDir, bundledDir }),
    ).rejects.toThrow(/failed to parse YAML/);
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

  it("throws on duplicate preset names within the home root", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    const root = path.join(homeDir, ".swarm", "presets");
    await writePresetFile(root, "a.yml", "name: same\nagents: [alpha, beta]");
    await writePresetFile(root, "b.yml", "name: same\nagents: [alpha, beta]");

    await expect(
      loadPresetRegistry({ cwd, homeDir, bundledDir }),
    ).rejects.toThrow(/duplicate preset "same"/);
  });

  it("throws on duplicate preset names within the bundled root", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      bundledDir,
      "a.yml",
      "name: same\nagents: [alpha, beta]",
    );
    await writePresetFile(
      bundledDir,
      "b.yml",
      "name: same\nagents: [alpha, beta]",
    );

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

  it("loads preset files with uppercase YAML extensions", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.YML",
      "name: product-decision\nagents: [product-manager, principal-engineer]",
    );

    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });

    expect(registry.getPreset("product-decision").agents).toEqual([
      "product-manager",
      "principal-engineer",
    ]);
  });

  it("loads preset files with uppercase .YAML extensions", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.YAML",
      "name: product-decision\nagents: [product-manager, principal-engineer]",
    );

    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });

    expect(registry.getPreset("product-decision").agents).toEqual([
      "product-manager",
      "principal-engineer",
    ]);
  });

  it("loads home-root preset files with uppercase YAML extensions", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.YML",
      "name: product-decision\nagents: [from-home, principal-engineer]",
    );

    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });

    expect(registry.getPreset("product-decision").agents).toEqual([
      "from-home",
      "principal-engineer",
    ]);
  });

  it("loads home-root preset files with uppercase .YAML extensions", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.YAML",
      "name: product-decision\nagents: [from-home-yaml, principal-engineer]",
    );

    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });

    expect(registry.getPreset("product-decision").agents).toEqual([
      "from-home-yaml",
      "principal-engineer",
    ]);
  });

  it("loads bundled-root preset files with uppercase YAML extensions", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      bundledDir,
      "product-decision.YML",
      "name: product-decision\nagents: [from-bundled, principal-engineer]",
    );

    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });

    expect(registry.getPreset("product-decision").agents).toEqual([
      "from-bundled",
      "principal-engineer",
    ]);
  });

  it("loads bundled-root preset files with uppercase .YAML extensions", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      bundledDir,
      "product-decision.YAML",
      "name: product-decision\nagents: [from-bundled-yaml, principal-engineer]",
    );

    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });

    expect(registry.getPreset("product-decision").agents).toEqual([
      "from-bundled-yaml",
      "principal-engineer",
    ]);
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

  it("loads a same-root matching preset even when a sibling filename matches but declares a different name", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.yml",
      [
        "name: different-preset",
        "agents:",
        "  - from-project-mismatch",
        "  - principal-engineer",
        "resolve: off",
      ].join("\n"),
    );
    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.yaml",
      [
        "name: product-decision",
        "agents:",
        "  - from-project",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );

    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });

    expect(registry.getPreset("product-decision").agents).toEqual([
      "from-project",
      "principal-engineer",
    ]);
    expect(registry.getPreset("different-preset").agents).toEqual([
      "from-project-mismatch",
      "principal-engineer",
    ]);
  });

  it("loads a same-root home preset even when a sibling filename matches but declares a different name", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.yml",
      [
        "name: different-preset",
        "agents:",
        "  - from-home-mismatch",
        "  - principal-engineer",
        "resolve: off",
      ].join("\n"),
    );
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.yaml",
      [
        "name: product-decision",
        "agents:",
        "  - from-home",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );

    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });

    expect(registry.getPreset("product-decision").agents).toEqual([
      "from-home",
      "principal-engineer",
    ]);
    expect(registry.getPreset("different-preset").agents).toEqual([
      "from-home-mismatch",
      "principal-engineer",
    ]);
  });

  it("loads a same-root bundled preset even when a sibling filename matches but declares a different name", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      [
        "name: different-preset",
        "agents:",
        "  - from-bundled-mismatch",
        "  - principal-engineer",
        "resolve: off",
      ].join("\n"),
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yaml",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );

    const registry = await loadPresetRegistry({ cwd, homeDir, bundledDir });

    expect(registry.getPreset("product-decision").agents).toEqual([
      "from-bundled",
      "principal-engineer",
    ]);
    expect(registry.getPreset("different-preset").agents).toEqual([
      "from-bundled-mismatch",
      "principal-engineer",
    ]);
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

  it("loads the bundled triad preset from the default bundled directory", async () => {
    const cwd = await makeTempDir("swarm-preset-cwd-");
    const homeDir = await makeTempDir("swarm-preset-home-");

    const registry = await loadPresetRegistry({ cwd, homeDir });
    const preset = registry.getPreset("triad");
    expect(preset.agents).toEqual([
      "product-manager",
      "principal-engineer",
      "product-designer",
    ]);
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
  it("trims and lowercases the requested preset name on successful lookup", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

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

    const preset = await resolvePresetByName("  PRODUCT-DECISION  ", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.name).toBe("product-decision");
    expect(preset.agents).toEqual(["product-manager", "principal-engineer"]);
    expect(preset.resolve).toBe("orchestrator");
  });

  it("throws a clear error for an unknown preset", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await expect(
      resolvePresetByName("  NOPE  ", {
        cwd,
        homeDir,
        bundledDir,
      }),
    ).rejects.toThrow(/unknown preset "nope"/);
  });

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

  it("falls back to home presets before bundled roots", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    const presetName = "product-decision";

    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.yml",
      [
        `name: ${presetName}`,
        "agents:",
        "  - from-home",
        "  - principal-engineer",
        "resolve: agents",
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

    expect(preset.agents).toEqual(["from-home", "principal-engineer"]);
    expect(preset.resolve).toBe("agents");
  });

  it("returns the higher-priority preset without loading a broken lower-priority match", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - from-project",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.yml",
      "name: product-decision\nagents: [unterminated",
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["from-project", "principal-engineer"]);
    expect(preset.resolve).toBe("agents");
  });

  it("returns the home preset without loading a broken bundled match", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - from-home",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      "name: product-decision\nagents: [unterminated",
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["from-home", "principal-engineer"]);
    expect(preset.resolve).toBe("agents");
  });

  it("returns the home preset without loading an invalid bundled match", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - from-home",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      ["name: product-decision", "agents:", "  - from-bundled"].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["from-home", "principal-engineer"]);
    expect(preset.resolve).toBe("agents");
  });

  it("returns the home preset without loading duplicate bundled matches", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - from-home",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled-yml",
        "  - principal-engineer",
        "resolve: off",
      ].join("\n"),
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yaml",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled-yaml",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["from-home", "principal-engineer"]);
    expect(preset.resolve).toBe("agents");
  });

  it("returns the higher-priority preset without loading duplicate lower-priority matches", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.yml",
      [
        "name: product-decision",
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
        "name: product-decision",
        "agents:",
        "  - from-home-yml",
        "  - principal-engineer",
        "resolve: off",
      ].join("\n"),
    );
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.yaml",
      [
        "name: product-decision",
        "agents:",
        "  - from-home-yaml",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["from-project", "principal-engineer"]);
    expect(preset.resolve).toBe("agents");
  });

  it("returns the higher-priority preset without loading duplicate bundled matches", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - from-project",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled-yml",
        "  - principal-engineer",
        "resolve: off",
      ].join("\n"),
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yaml",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled-yaml",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["from-project", "principal-engineer"]);
    expect(preset.resolve).toBe("agents");
  });

  it("falls back to bundled presets when project and home roots are missing the preset", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["from-bundled", "principal-engineer"]);
    expect(preset.resolve).toBe("orchestrator");
  });

  it("resolves requested preset files with uppercase YAML extensions", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.YML",
      [
        "name: product-decision",
        "agents:",
        "  - from-project",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["from-project", "principal-engineer"]);
    expect(preset.resolve).toBe("agents");
  });

  it("resolves requested preset files with uppercase .YAML extensions", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.YAML",
      [
        "name: product-decision",
        "agents:",
        "  - from-project-yaml",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["from-project-yaml", "principal-engineer"]);
    expect(preset.resolve).toBe("agents");
  });

  it("resolves requested home-root preset files with uppercase YAML extensions", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.YML",
      [
        "name: product-decision",
        "agents:",
        "  - from-home",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["from-home", "principal-engineer"]);
    expect(preset.resolve).toBe("agents");
  });

  it("resolves requested home-root preset files with uppercase .YAML extensions", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.YAML",
      [
        "name: product-decision",
        "agents:",
        "  - from-home-yaml",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["from-home-yaml", "principal-engineer"]);
    expect(preset.resolve).toBe("agents");
  });

  it("resolves requested bundled-root preset files with uppercase YAML extensions", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      bundledDir,
      "product-decision.YML",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["from-bundled", "principal-engineer"]);
    expect(preset.resolve).toBe("orchestrator");
  });

  it("resolves requested bundled-root preset files with uppercase .YAML extensions", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      bundledDir,
      "product-decision.YAML",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled-yaml",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.agents).toEqual(["from-bundled-yaml", "principal-engineer"]);
    expect(preset.resolve).toBe("orchestrator");
  });

  it("ignores a matching filename when the declared preset name differs", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.yml",
      [
        "name: different-preset",
        "agents:",
        "  - from-project",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.name).toBe("product-decision");
    expect(preset.agents).toEqual(["from-bundled", "principal-engineer"]);
    expect(preset.resolve).toBe("orchestrator");
  });

  it("resolves a same-root matching preset even when a sibling filename matches but declares a different name", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.yml",
      [
        "name: different-preset",
        "agents:",
        "  - from-project-mismatch",
        "  - principal-engineer",
        "resolve: off",
      ].join("\n"),
    );
    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.yaml",
      [
        "name: product-decision",
        "agents:",
        "  - from-project",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.name).toBe("product-decision");
    expect(preset.agents).toEqual(["from-project", "principal-engineer"]);
    expect(preset.resolve).toBe("agents");
  });

  it("ignores a matching home-root filename when the declared preset name differs", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.yml",
      [
        "name: different-preset",
        "agents:",
        "  - from-home",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.name).toBe("product-decision");
    expect(preset.agents).toEqual(["from-bundled", "principal-engineer"]);
    expect(preset.resolve).toBe("orchestrator");
  });

  it("resolves a same-root home preset even when a sibling filename matches but declares a different name", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.yml",
      [
        "name: different-preset",
        "agents:",
        "  - from-home-mismatch",
        "  - principal-engineer",
        "resolve: off",
      ].join("\n"),
    );
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.yaml",
      [
        "name: product-decision",
        "agents:",
        "  - from-home",
        "  - principal-engineer",
        "resolve: agents",
      ].join("\n"),
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.name).toBe("product-decision");
    expect(preset.agents).toEqual(["from-home", "principal-engineer"]);
    expect(preset.resolve).toBe("agents");
  });

  it("ignores a matching bundled-root filename when the declared preset name differs", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      [
        "name: different-preset",
        "agents:",
        "  - from-bundled-mismatch",
        "  - principal-engineer",
        "resolve: off",
      ].join("\n"),
    );
    await writePresetFile(
      bundledDir,
      "product-decision.yaml",
      [
        "name: product-decision",
        "agents:",
        "  - from-bundled",
        "  - principal-engineer",
        "resolve: orchestrator",
      ].join("\n"),
    );

    const preset = await resolvePresetByName("product-decision", {
      cwd,
      homeDir,
      bundledDir,
    });

    expect(preset.name).toBe("product-decision");
    expect(preset.agents).toEqual(["from-bundled", "principal-engineer"]);
    expect(preset.resolve).toBe("orchestrator");
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

  it("resolves the requested bundled preset while ignoring unrelated invalid preset files in the bundled root", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      bundledDir,
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

  it("resolves the requested preset while ignoring unrelated malformed YAML preset files", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "broken-preset.yml",
      "name: broken-preset\nagents: [unterminated",
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

  it("resolves the requested preset while ignoring unrelated malformed YAML home preset files", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "broken-preset.yml",
      "name: broken-preset\nagents: [unterminated",
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

  it("resolves the requested bundled preset while ignoring unrelated malformed YAML files in the bundled root", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      bundledDir,
      "broken-preset.yml",
      "name: broken-preset\nagents: [unterminated",
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

  it("throws when the requested preset file itself is invalid", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.yml",
      "name: product-decision\nagents: [solo]",
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

    await expect(
      resolvePresetByName("product-decision", {
        cwd,
        homeDir,
        bundledDir,
      }),
    ).rejects.toThrow(/invalid preset/);
  });

  it("throws when the requested home-root preset file itself is invalid", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.yml",
      "name: product-decision\nagents: [solo]",
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

    await expect(
      resolvePresetByName("product-decision", {
        cwd,
        homeDir,
        bundledDir,
      }),
    ).rejects.toThrow(/invalid preset/);
  });

  it("throws when the requested bundled-root preset file itself is invalid", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      "name: product-decision\nagents: [solo]",
    );

    await expect(
      resolvePresetByName("product-decision", {
        cwd,
        homeDir,
        bundledDir,
      }),
    ).rejects.toThrow(/invalid preset/);
  });

  it("throws when the requested preset file itself contains malformed YAML", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(cwd, ".swarm", "presets"),
      "product-decision.yml",
      "name: product-decision\nagents: [unterminated",
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

    await expect(
      resolvePresetByName("product-decision", {
        cwd,
        homeDir,
        bundledDir,
      }),
    ).rejects.toThrow(/failed to parse YAML/);
  });

  it("throws when the requested home-root preset file itself contains malformed YAML", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      path.join(homeDir, ".swarm", "presets"),
      "product-decision.yml",
      "name: product-decision\nagents: [unterminated",
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

    await expect(
      resolvePresetByName("product-decision", {
        cwd,
        homeDir,
        bundledDir,
      }),
    ).rejects.toThrow(/failed to parse YAML/);
  });

  it("throws when the requested bundled-root preset file itself contains malformed YAML", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    await writePresetFile(
      bundledDir,
      "product-decision.yml",
      "name: product-decision\nagents: [unterminated",
    );

    await expect(
      resolvePresetByName("product-decision", {
        cwd,
        homeDir,
        bundledDir,
      }),
    ).rejects.toThrow(/failed to parse YAML/);
  });

  it("throws on duplicate preset names within the same root", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    const root = path.join(cwd, ".swarm", "presets");

    await writePresetFile(root, "dup.yml", "name: dup\nagents: [from-yml, pm]");
    await writePresetFile(
      root,
      "dup.yaml",
      "name: dup\nagents: [from-yaml, pm]",
    );

    await expect(
      resolvePresetByName("dup", { cwd, homeDir, bundledDir }),
    ).rejects.toThrow(/duplicate preset "dup"/);
  });

  it("throws on duplicate preset names within the home root", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();
    const root = path.join(homeDir, ".swarm", "presets");

    await writePresetFile(
      root,
      "dup.yml",
      "name: dup\nagents: [from-home-yml, pm]",
    );
    await writePresetFile(
      root,
      "dup.yaml",
      "name: dup\nagents: [from-home-yaml, pm]",
    );

    await expect(
      resolvePresetByName("dup", { cwd, homeDir, bundledDir }),
    ).rejects.toThrow(/duplicate preset "dup"/);
  });

  it("throws on duplicate preset names within the bundled root", async () => {
    const { cwd, homeDir, bundledDir } = await makeIsolatedRoots();

    await writePresetFile(
      bundledDir,
      "dup.yml",
      "name: dup\nagents: [from-bundled-yml, pm]",
    );
    await writePresetFile(
      bundledDir,
      "dup.yaml",
      "name: dup\nagents: [from-bundled-yaml, pm]",
    );

    await expect(
      resolvePresetByName("dup", { cwd, homeDir, bundledDir }),
    ).rejects.toThrow(/duplicate preset "dup"/);
  });
});
