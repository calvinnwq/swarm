import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadAgentRegistry,
  SwarmCommandError,
} from "../../../src/lib/index.js";

interface TempRegistryRoots {
  rootDir: string;
  cwd: string;
  homeDir: string;
  bundledDir: string;
}

async function makeTempRoots(): Promise<TempRegistryRoots> {
  const rootDir = await mkdtemp(path.join(tmpdir(), "swarm-agent-registry-"));
  const cwd = path.join(rootDir, "cwd");
  const homeDir = path.join(rootDir, "home");
  const bundledDir = path.join(rootDir, "bundled");

  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(homeDir, { recursive: true }),
    mkdir(bundledDir, { recursive: true }),
  ]);

  return { rootDir, cwd, homeDir, bundledDir };
}

function projectAgentsDir(roots: TempRegistryRoots): string {
  return path.join(roots.cwd, ".swarm", "agents");
}

function globalAgentsDir(roots: TempRegistryRoots): string {
  return path.join(roots.homeDir, ".swarm", "agents");
}

async function writeDefinition(
  dir: string,
  filename: string,
  contents: string,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await writeFile(filePath, contents, "utf-8");
  return filePath;
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("loadAgentRegistry", () => {
  it("prefers project-local definitions over global and bundled", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "analyst.yml",
      [
        "name: analyst",
        "description: bundled analyst",
        "persona: bundled persona",
        "prompt: bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "analyst.yml",
      [
        "name: analyst",
        "description: global analyst",
        "persona: global persona",
        "prompt: global prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      projectAgentsDir(roots),
      "analyst.yml",
      [
        "name: analyst",
        "description: project analyst",
        "persona: project persona",
        "prompt: project prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("analyst")).toMatchObject({
      name: "analyst",
      description: "project analyst",
      persona: "project persona",
      prompt: "project prompt",
    });
  });

  it("surfaces searched roots when an agent is missing", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(() => registry.getAgent("missing-agent")).toThrow(SwarmCommandError);
    expect(() => registry.getAgent("missing-agent")).toThrow(/missing-agent/);
    expect(() => registry.getAgent("missing-agent")).toThrow(
      new RegExp(
        projectAgentsDir(roots).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ),
    );
    expect(() => registry.getAgent("missing-agent")).toThrow(
      new RegExp(globalAgentsDir(roots).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    expect(() => registry.getAgent("missing-agent")).toThrow(
      new RegExp(roots.bundledDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  it("normalizes requested agent names on successful lookup", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "product-manager.yml",
      [
        "name: product-manager",
        "description: bundled product manager",
        "persona: You balance value and scope.",
        "prompt: Return the product recommendation.",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("  PRODUCT-manager  ")).toMatchObject({
      name: "product-manager",
      description: "bundled product manager",
      prompt: "Return the product recommendation.",
    });
  });

  it("loads markdown definitions using the body as the prompt", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      projectAgentsDir(roots),
      "product-manager.md",
      [
        "---",
        "name: product-manager",
        "description: PM agent",
        "persona: You balance user value and scope.",
        "---",
        "",
        "  Turn this body into the prompt.  ",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("product-manager")).toMatchObject({
      prompt: "Turn this body into the prompt.",
    });
  });

  it("loads project-local markdown definitions with uppercase .MD extensions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      projectAgentsDir(roots),
      "facilitator.MD",
      [
        "---",
        "name: facilitator",
        "description: uppercase markdown facilitator",
        "persona: You keep the discussion moving.",
        "---",
        "",
        "Return the concise facilitation plan.",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("facilitator")).toMatchObject({
      name: "facilitator",
      description: "uppercase markdown facilitator",
      prompt: "Return the concise facilitation plan.",
    });
  });

  it("loads global markdown definitions with uppercase .MD extensions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      globalAgentsDir(roots),
      "moderator.MD",
      [
        "---",
        "name: moderator",
        "description: uppercase global markdown moderator",
        "persona: You steer the conversation.",
        "---",
        "",
        "Return the moderated next step.",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("moderator")).toMatchObject({
      name: "moderator",
      description: "uppercase global markdown moderator",
      prompt: "Return the moderated next step.",
    });
  });

  it("loads bundled markdown definitions with uppercase .MD extensions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "operator.MD",
      [
        "---",
        "name: operator",
        "description: uppercase bundled markdown operator",
        "persona: You keep the system stable.",
        "---",
        "",
        "Return the operational next step.",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("operator")).toMatchObject({
      name: "operator",
      description: "uppercase bundled markdown operator",
      prompt: "Return the operational next step.",
    });
  });

  it("loads project-local YAML definitions with uppercase .YML extensions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      projectAgentsDir(roots),
      "analyst.YML",
      [
        "name: analyst",
        "description: uppercase analyst",
        "persona: You inspect evidence.",
        "prompt: Return the focused analysis.",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("analyst")).toMatchObject({
      name: "analyst",
      description: "uppercase analyst",
      prompt: "Return the focused analysis.",
    });
  });

  it("loads project-local YAML definitions with uppercase .YAML extensions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      projectAgentsDir(roots),
      "architect.YAML",
      [
        "name: architect",
        "description: uppercase architect",
        "persona: You shape the system boundaries.",
        "prompt: Return the architecture recommendation.",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("architect")).toMatchObject({
      name: "architect",
      description: "uppercase architect",
      prompt: "Return the architecture recommendation.",
    });
  });

  it("loads global YAML definitions with uppercase .YML extensions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      globalAgentsDir(roots),
      "researcher.YML",
      [
        "name: researcher",
        "description: uppercase global researcher",
        "persona: You synthesize evidence.",
        "prompt: Return the concise research summary.",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      name: "researcher",
      description: "uppercase global researcher",
      prompt: "Return the concise research summary.",
    });
  });

  it("loads global YAML definitions with uppercase .YAML extensions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      globalAgentsDir(roots),
      "strategist.YAML",
      [
        "name: strategist",
        "description: uppercase global strategist",
        "persona: You frame the tradeoffs.",
        "prompt: Return the strategic recommendation.",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("strategist")).toMatchObject({
      name: "strategist",
      description: "uppercase global strategist",
      prompt: "Return the strategic recommendation.",
    });
  });

  it("loads bundled YAML definitions with uppercase .YML extensions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "planner.YML",
      [
        "name: planner",
        "description: uppercase bundled planner",
        "persona: You sequence work.",
        "prompt: Return the minimal step plan.",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("planner")).toMatchObject({
      name: "planner",
      description: "uppercase bundled planner",
      prompt: "Return the minimal step plan.",
    });
  });

  it("loads bundled YAML definitions with uppercase .YAML extensions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "operator.YAML",
      [
        "name: operator",
        "description: uppercase bundled operator",
        "persona: You keep the system running.",
        "prompt: Return the operational recommendation.",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("operator")).toMatchObject({
      name: "operator",
      description: "uppercase bundled operator",
      prompt: "Return the operational recommendation.",
    });
  });

  it("prefers global definitions over bundled when no project override exists", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "researcher.yml",
      [
        "name: researcher",
        "description: bundled researcher",
        "persona: bundled persona",
        "prompt: bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "researcher.yml",
      [
        "name: researcher",
        "description: global researcher",
        "persona: global persona",
        "prompt: global prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      description: "global researcher",
      prompt: "global prompt",
    });
  });

  it("prefers global markdown definitions over same-name bundled markdown definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: bundled researcher",
        "persona: bundled persona",
        "---",
        "",
        "bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: global researcher",
        "persona: global persona",
        "---",
        "",
        "global prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      name: "researcher",
      description: "global researcher",
      persona: "global persona",
      prompt: "global prompt",
    });
  });

  it("prefers global markdown definitions over same-name bundled yaml definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "researcher.yml",
      [
        "name: researcher",
        "description: bundled researcher",
        "persona: bundled persona",
        "prompt: bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: global researcher",
        "persona: global persona",
        "---",
        "",
        "global prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      name: "researcher",
      description: "global researcher",
      persona: "global persona",
      prompt: "global prompt",
    });
  });

  it("prefers global yaml definitions over same-name bundled markdown definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: bundled researcher",
        "persona: bundled persona",
        "---",
        "",
        "bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "researcher.yml",
      [
        "name: researcher",
        "description: global researcher",
        "persona: global persona",
        "prompt: global prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      name: "researcher",
      description: "global researcher",
      persona: "global persona",
      prompt: "global prompt",
    });
  });

  it("prefers global yaml definitions over same-name bundled yaml definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "researcher.yml",
      [
        "name: researcher",
        "description: bundled researcher",
        "persona: bundled persona",
        "prompt: bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "researcher.yml",
      [
        "name: researcher",
        "description: global researcher",
        "persona: global persona",
        "prompt: global prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      name: "researcher",
      description: "global researcher",
      persona: "global persona",
      prompt: "global prompt",
    });
  });

  it("prefers project markdown definitions over same-name global and bundled markdown definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: bundled researcher",
        "persona: bundled persona",
        "---",
        "",
        "bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: global researcher",
        "persona: global persona",
        "---",
        "",
        "global prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      projectAgentsDir(roots),
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: project researcher",
        "persona: project persona",
        "---",
        "",
        "project prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      name: "researcher",
      description: "project researcher",
      persona: "project persona",
      prompt: "project prompt",
    });
  });

  it("prefers project markdown definitions over same-name global and bundled yaml definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "researcher.yml",
      [
        "name: researcher",
        "description: bundled researcher",
        "persona: bundled persona",
        "prompt: bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "researcher.yaml",
      [
        "name: researcher",
        "description: global researcher",
        "persona: global persona",
        "prompt: global prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      projectAgentsDir(roots),
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: project researcher",
        "persona: project persona",
        "---",
        "",
        "project prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      name: "researcher",
      description: "project researcher",
      persona: "project persona",
      prompt: "project prompt",
    });
  });

  it("prefers project markdown definitions over same-name global yaml and bundled markdown definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: bundled researcher",
        "persona: bundled persona",
        "---",
        "",
        "bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "researcher.yml",
      [
        "name: researcher",
        "description: global researcher",
        "persona: global persona",
        "prompt: global prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      projectAgentsDir(roots),
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: project researcher",
        "persona: project persona",
        "---",
        "",
        "project prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      name: "researcher",
      description: "project researcher",
      persona: "project persona",
      prompt: "project prompt",
    });
  });

  it("prefers project markdown definitions over same-name global markdown and bundled yaml definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "researcher.yml",
      [
        "name: researcher",
        "description: bundled researcher",
        "persona: bundled persona",
        "prompt: bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: global researcher",
        "persona: global persona",
        "---",
        "",
        "global prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      projectAgentsDir(roots),
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: project researcher",
        "persona: project persona",
        "---",
        "",
        "project prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      name: "researcher",
      description: "project researcher",
      persona: "project persona",
      prompt: "project prompt",
    });
  });

  it("prefers project yaml definitions over same-name global and bundled markdown definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: bundled researcher",
        "persona: bundled persona",
        "---",
        "",
        "bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: global researcher",
        "persona: global persona",
        "---",
        "",
        "global prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      projectAgentsDir(roots),
      "researcher.yml",
      [
        "name: researcher",
        "description: project researcher",
        "persona: project persona",
        "prompt: project prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      name: "researcher",
      description: "project researcher",
      persona: "project persona",
      prompt: "project prompt",
    });
  });

  it("prefers project yaml definitions over same-name global markdown and bundled yaml definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "researcher.yml",
      [
        "name: researcher",
        "description: bundled researcher",
        "persona: bundled persona",
        "prompt: bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: global researcher",
        "persona: global persona",
        "---",
        "",
        "global prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      projectAgentsDir(roots),
      "researcher.yml",
      [
        "name: researcher",
        "description: project researcher",
        "persona: project persona",
        "prompt: project prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      name: "researcher",
      description: "project researcher",
      persona: "project persona",
      prompt: "project prompt",
    });
  });

  it("prefers project yaml definitions over same-name global yaml and bundled markdown definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "researcher.md",
      [
        "---",
        "name: researcher",
        "description: bundled researcher",
        "persona: bundled persona",
        "---",
        "",
        "bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "researcher.yaml",
      [
        "name: researcher",
        "description: global researcher",
        "persona: global persona",
        "prompt: global prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      projectAgentsDir(roots),
      "researcher.yml",
      [
        "name: researcher",
        "description: project researcher",
        "persona: project persona",
        "prompt: project prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      name: "researcher",
      description: "project researcher",
      persona: "project persona",
      prompt: "project prompt",
    });
  });

  it("prefers project yaml definitions over same-name global and bundled yaml definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "researcher.yml",
      [
        "name: researcher",
        "description: bundled researcher",
        "persona: bundled persona",
        "prompt: bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "researcher.yaml",
      [
        "name: researcher",
        "description: global researcher",
        "persona: global persona",
        "prompt: global prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      projectAgentsDir(roots),
      "researcher.yml",
      [
        "name: researcher",
        "description: project researcher",
        "persona: project persona",
        "prompt: project prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      name: "researcher",
      description: "project researcher",
      persona: "project persona",
      prompt: "project prompt",
    });
  });

  it("lists each agent name once using the highest-priority definition", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "analyst.yml",
      [
        "name: analyst",
        "description: bundled analyst",
        "persona: bundled persona",
        "prompt: bundled prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "analyst.yml",
      [
        "name: analyst",
        "description: global analyst",
        "persona: global persona",
        "prompt: global prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      projectAgentsDir(roots),
      "analyst.yml",
      [
        "name: analyst",
        "description: project analyst",
        "persona: project persona",
        "prompt: project prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      roots.bundledDir,
      "principal-engineer.yml",
      [
        "name: principal-engineer",
        "description: bundled principal engineer",
        "persona: bundled engineering persona",
        "prompt: bundled engineering prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.listAgents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "analyst",
          description: "project analyst",
          prompt: "project prompt",
        }),
        expect.objectContaining({
          name: "principal-engineer",
          description: "bundled principal engineer",
          prompt: "bundled engineering prompt",
        }),
      ]),
    );
    expect(registry.listAgents()).toHaveLength(2);
  });

  it("ignores subdirectories and unsupported files in agent roots", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await mkdir(path.join(projectAgentsDir(roots), "nested"), {
      recursive: true,
    });
    await writeDefinition(
      projectAgentsDir(roots),
      "notes.txt",
      "this should be ignored\n",
    );
    await writeDefinition(
      projectAgentsDir(roots),
      "analyst.yml",
      [
        "name: analyst",
        "description: project analyst",
        "persona: project persona",
        "prompt: project prompt",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      path.join(projectAgentsDir(roots), "nested"),
      "reviewer.yml",
      [
        "name: reviewer",
        "description: nested reviewer",
        "persona: nested persona",
        "prompt: nested prompt",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("analyst")).toMatchObject({
      name: "analyst",
      description: "project analyst",
      prompt: "project prompt",
    });
    expect(registry.listAgents()).toEqual([
      expect.objectContaining({
        name: "analyst",
        description: "project analyst",
        prompt: "project prompt",
      }),
    ]);
    expect(() => registry.getAgent("reviewer")).toThrow(/unknown agent/);
  });

  it("surfaces the file path for malformed yaml files", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      projectAgentsDir(roots),
      "broken.yml",
      "name: broken\nprompt: [unterminated\n",
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/failed to parse YAML/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(filePath);
  });

  it("surfaces the file path for malformed global yaml files", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      globalAgentsDir(roots),
      "broken.yml",
      "name: broken\nprompt: [unterminated\n",
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/failed to parse YAML/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(filePath);
  });

  it("surfaces the file path for malformed bundled yaml files", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      roots.bundledDir,
      "broken.yml",
      "name: broken\nprompt: [unterminated\n",
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/failed to parse YAML/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(filePath);
  });

  it("rejects yaml files whose document parses to a non-object value", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      projectAgentsDir(roots),
      "scalar.yml",
      "just a scalar\n",
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `invalid agent definition in ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("rejects global yaml files whose document parses to a non-object value", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      globalAgentsDir(roots),
      "scalar.yml",
      "just a scalar\n",
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `invalid agent definition in ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("rejects bundled yaml files whose document parses to a non-object value", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      roots.bundledDir,
      "scalar.yml",
      "just a scalar\n",
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `invalid agent definition in ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("surfaces the file path for malformed markdown frontmatter", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      projectAgentsDir(roots),
      "broken.md",
      ["---", "name: broken", "prompt: [unterminated", "---", "", "body"].join(
        "\n",
      ),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/failed to parse frontmatter/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(filePath);
  });

  it("surfaces the file path for malformed global markdown frontmatter", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      globalAgentsDir(roots),
      "broken.md",
      ["---", "name: broken", "prompt: [unterminated", "---", "", "body"].join(
        "\n",
      ),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/failed to parse frontmatter/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(filePath);
  });

  it("surfaces the file path for malformed bundled markdown frontmatter", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      roots.bundledDir,
      "broken.md",
      ["---", "name: broken", "prompt: [unterminated", "---", "", "body"].join(
        "\n",
      ),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/failed to parse frontmatter/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(filePath);
  });

  it("rejects markdown files missing an opening frontmatter fence", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      projectAgentsDir(roots),
      "missing-fence.md",
      [
        "name: missing-fence",
        "description: invalid markdown agent",
        "persona: You should fail to load.",
        "prompt: inline prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `markdown definition is missing frontmatter fence: ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("rejects global markdown files missing an opening frontmatter fence", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      globalAgentsDir(roots),
      "missing-fence.md",
      [
        "name: missing-fence",
        "description: invalid markdown agent",
        "persona: You should fail to load.",
        "prompt: inline prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `markdown definition is missing frontmatter fence: ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("rejects bundled markdown files missing an opening frontmatter fence", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      roots.bundledDir,
      "missing-fence.md",
      [
        "name: missing-fence",
        "description: invalid markdown agent",
        "persona: You should fail to load.",
        "prompt: inline prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `markdown definition is missing frontmatter fence: ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("rejects markdown files missing a closing frontmatter fence", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      projectAgentsDir(roots),
      "missing-closing-fence.md",
      [
        "---",
        "name: missing-closing-fence",
        "description: invalid markdown agent",
        "persona: You should fail to load.",
        "prompt: inline prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `markdown definition is missing closing frontmatter fence: ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("rejects global markdown files missing a closing frontmatter fence", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      globalAgentsDir(roots),
      "missing-closing-fence.md",
      [
        "---",
        "name: missing-closing-fence",
        "description: invalid markdown agent",
        "persona: You should fail to load.",
        "prompt: inline prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `markdown definition is missing closing frontmatter fence: ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("rejects bundled markdown files missing a closing frontmatter fence", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      roots.bundledDir,
      "missing-closing-fence.md",
      [
        "---",
        "name: missing-closing-fence",
        "description: invalid markdown agent",
        "persona: You should fail to load.",
        "prompt: inline prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `markdown definition is missing closing frontmatter fence: ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("parses markdown inline prompt the same way as yaml", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      projectAgentsDir(roots),
      "principal-engineer.md",
      [
        "---",
        "name: principal-engineer",
        "description: Principal engineer",
        "persona: You lead implementation details.",
        "prompt: Return structured engineering output.",
        "---",
        "",
      ].join("\n"),
    );
    await writeDefinition(
      globalAgentsDir(roots),
      "principal-engineer.yml",
      [
        "name: principal-engineer",
        "description: Principal engineer",
        "persona: You lead implementation details.",
        "prompt: Return structured engineering output.",
        "",
      ].join("\n"),
    );

    const projectRegistry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: path.join(roots.rootDir, "empty-home"),
      bundledDir: roots.bundledDir,
    });
    const globalRegistry = await loadAgentRegistry({
      cwd: path.join(roots.rootDir, "empty-cwd"),
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(projectRegistry.getAgent("principal-engineer")).toEqual(
      globalRegistry.getAgent("principal-engineer"),
    );
  });

  it("rejects markdown files that define both frontmatter prompt and body content", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      projectAgentsDir(roots),
      "conflict.md",
      [
        "---",
        "name: conflict",
        "description: conflicting prompt",
        "persona: You should fail to load.",
        "prompt: inline prompt",
        "---",
        "",
        "body prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(filePath);
  });

  it("rejects global markdown files that define both frontmatter prompt and body content", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      globalAgentsDir(roots),
      "conflict.md",
      [
        "---",
        "name: conflict",
        "description: conflicting prompt",
        "persona: You should fail to load.",
        "prompt: inline prompt",
        "---",
        "",
        "body prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(filePath);
  });

  it("rejects bundled markdown files that define both frontmatter prompt and body content", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      roots.bundledDir,
      "conflict.md",
      [
        "---",
        "name: conflict",
        "description: conflicting prompt",
        "persona: You should fail to load.",
        "prompt: inline prompt",
        "---",
        "",
        "body prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(filePath);
  });

  it("rejects markdown files that define both prompt.file frontmatter and body content", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      projectAgentsDir(roots),
      "conflict-file-prompt.md",
      [
        "---",
        "name: conflict-file-prompt",
        "description: conflicting file prompt",
        "persona: You should fail to load.",
        "prompt:",
        "  file: prompts/conflict.md",
        "---",
        "",
        "body prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(filePath);
  });

  it("rejects global markdown files that define both prompt.file frontmatter and body content", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      globalAgentsDir(roots),
      "conflict-file-prompt.md",
      [
        "---",
        "name: conflict-file-prompt",
        "description: conflicting file prompt",
        "persona: You should fail to load.",
        "prompt:",
        "  file: prompts/conflict.md",
        "---",
        "",
        "body prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(filePath);
  });

  it("rejects bundled markdown files that define both prompt.file frontmatter and body content", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      roots.bundledDir,
      "conflict-file-prompt.md",
      [
        "---",
        "name: conflict-file-prompt",
        "description: conflicting file prompt",
        "persona: You should fail to load.",
        "prompt:",
        "  file: prompts/conflict.md",
        "---",
        "",
        "body prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(filePath);
  });

  it("rejects markdown files that omit both frontmatter prompt and body content", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      projectAgentsDir(roots),
      "empty-prompt.md",
      [
        "---",
        "name: empty-prompt",
        "description: missing prompt",
        "persona: You should fail to load.",
        "---",
        "",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `markdown definition must provide a prompt in frontmatter or body: ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("rejects global markdown files that omit both frontmatter prompt and body content", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      globalAgentsDir(roots),
      "empty-prompt.md",
      [
        "---",
        "name: empty-prompt",
        "description: missing prompt",
        "persona: You should fail to load.",
        "---",
        "",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `markdown definition must provide a prompt in frontmatter or body: ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("rejects bundled markdown files that omit both frontmatter prompt and body content", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      roots.bundledDir,
      "empty-prompt.md",
      [
        "---",
        "name: empty-prompt",
        "description: missing prompt",
        "persona: You should fail to load.",
        "---",
        "",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `markdown definition must provide a prompt in frontmatter or body: ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("rejects markdown files whose frontmatter parses to a non-object value", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      projectAgentsDir(roots),
      "scalar-frontmatter.md",
      ["---", "just a scalar", "---", "", "body prompt"].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `invalid agent definition in ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("rejects global markdown files whose frontmatter parses to a non-object value", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      globalAgentsDir(roots),
      "scalar-frontmatter.md",
      ["---", "just a scalar", "---", "", "body prompt"].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `invalid agent definition in ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("rejects bundled markdown files whose frontmatter parses to a non-object value", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const filePath = await writeDefinition(
      roots.bundledDir,
      "scalar-frontmatter.md",
      ["---", "just a scalar", "---", "", "body prompt"].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(
      new RegExp(
        `invalid agent definition in ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("rejects same-directory name collisions across file formats", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const yamlPath = await writeDefinition(
      projectAgentsDir(roots),
      "pm.yml",
      [
        "name: product-manager",
        "description: yaml pm",
        "persona: yaml persona",
        "prompt: yaml prompt",
        "",
      ].join("\n"),
    );
    const markdownPath = await writeDefinition(
      projectAgentsDir(roots),
      "pm.md",
      [
        "---",
        "name: product-manager",
        "description: md pm",
        "persona: md persona",
        "---",
        "",
        "markdown prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(yamlPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(markdownPath);
  });

  it("rejects global same-directory name collisions across file formats", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const yamlPath = await writeDefinition(
      globalAgentsDir(roots),
      "pm.yml",
      [
        "name: product-manager",
        "description: yaml pm",
        "persona: yaml persona",
        "prompt: yaml prompt",
        "",
      ].join("\n"),
    );
    const markdownPath = await writeDefinition(
      globalAgentsDir(roots),
      "pm.md",
      [
        "---",
        "name: product-manager",
        "description: md pm",
        "persona: md persona",
        "---",
        "",
        "markdown prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(yamlPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(markdownPath);
  });

  it("rejects bundled same-directory name collisions across file formats", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const yamlPath = await writeDefinition(
      roots.bundledDir,
      "pm.yml",
      [
        "name: product-manager",
        "description: yaml pm",
        "persona: yaml persona",
        "prompt: yaml prompt",
        "",
      ].join("\n"),
    );
    const markdownPath = await writeDefinition(
      roots.bundledDir,
      "pm.md",
      [
        "---",
        "name: product-manager",
        "description: md pm",
        "persona: md persona",
        "---",
        "",
        "markdown prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(yamlPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(markdownPath);
  });

  it("rejects same-directory name collisions across markdown definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const firstPath = await writeDefinition(
      projectAgentsDir(roots),
      "pm.md",
      [
        "---",
        "name: product-manager",
        "description: first md pm",
        "persona: first md persona",
        "---",
        "",
        "first markdown prompt",
      ].join("\n"),
    );
    const secondPath = await writeDefinition(
      projectAgentsDir(roots),
      "product.md",
      [
        "---",
        "name: product-manager",
        "description: second md pm",
        "persona: second md persona",
        "---",
        "",
        "second markdown prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(firstPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(secondPath);
  });

  it("rejects global same-directory name collisions across markdown definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const firstPath = await writeDefinition(
      globalAgentsDir(roots),
      "pm.md",
      [
        "---",
        "name: product-manager",
        "description: first md pm",
        "persona: first md persona",
        "---",
        "",
        "first markdown prompt",
      ].join("\n"),
    );
    const secondPath = await writeDefinition(
      globalAgentsDir(roots),
      "product.md",
      [
        "---",
        "name: product-manager",
        "description: second md pm",
        "persona: second md persona",
        "---",
        "",
        "second markdown prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(firstPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(secondPath);
  });

  it("rejects bundled same-directory name collisions across markdown definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const firstPath = await writeDefinition(
      roots.bundledDir,
      "pm.md",
      [
        "---",
        "name: product-manager",
        "description: first md pm",
        "persona: first md persona",
        "---",
        "",
        "first markdown prompt",
      ].join("\n"),
    );
    const secondPath = await writeDefinition(
      roots.bundledDir,
      "product.md",
      [
        "---",
        "name: product-manager",
        "description: second md pm",
        "persona: second md persona",
        "---",
        "",
        "second markdown prompt",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(firstPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(secondPath);
  });

  it("rejects same-directory name collisions across YAML definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const firstPath = await writeDefinition(
      projectAgentsDir(roots),
      "pm.yml",
      [
        "name: product-manager",
        "description: first yml pm",
        "persona: first yml persona",
        "prompt: first yml prompt",
        "",
      ].join("\n"),
    );
    const secondPath = await writeDefinition(
      projectAgentsDir(roots),
      "product-manager.yml",
      [
        "name: product-manager",
        "description: second yml pm",
        "persona: second yml persona",
        "prompt: second yml prompt",
        "",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(firstPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(secondPath);
  });

  it("rejects project-local duplicate .yaml definitions with different filenames", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const firstPath = await writeDefinition(
      projectAgentsDir(roots),
      "pm.yaml",
      [
        "name: product-manager",
        "description: first yaml pm",
        "persona: first yaml persona",
        "prompt: first yaml prompt",
        "",
      ].join("\n"),
    );
    const secondPath = await writeDefinition(
      projectAgentsDir(roots),
      "product-manager.yaml",
      [
        "name: product-manager",
        "description: second yaml pm",
        "persona: second yaml persona",
        "prompt: second yaml prompt",
        "",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(firstPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(secondPath);
  });

  it("rejects same-directory name collisions across YAML extensions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const ymlPath = await writeDefinition(
      projectAgentsDir(roots),
      "pm.yml",
      [
        "name: product-manager",
        "description: yml pm",
        "persona: yml persona",
        "prompt: yml prompt",
        "",
      ].join("\n"),
    );
    const yamlPath = await writeDefinition(
      projectAgentsDir(roots),
      "pm.yaml",
      [
        "name: product-manager",
        "description: yaml pm",
        "persona: yaml persona",
        "prompt: yaml prompt",
        "",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(ymlPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(yamlPath);
  });

  it("rejects global duplicate YAML definitions with different filenames", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const primaryPath = await writeDefinition(
      globalAgentsDir(roots),
      "product-manager.yml",
      [
        "name: product-manager",
        "description: primary product manager",
        "persona: primary persona",
        "prompt: primary prompt",
        "",
      ].join("\n"),
    );
    const duplicatePath = await writeDefinition(
      globalAgentsDir(roots),
      "pm-backup.yml",
      [
        "name: product-manager",
        "description: duplicate product manager",
        "persona: duplicate persona",
        "prompt: duplicate prompt",
        "",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(primaryPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(duplicatePath);
  });

  it("rejects global duplicate .yaml definitions with different filenames", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const firstPath = await writeDefinition(
      globalAgentsDir(roots),
      "pm.yaml",
      [
        "name: product-manager",
        "description: first yaml pm",
        "persona: first yaml persona",
        "prompt: first yaml prompt",
        "",
      ].join("\n"),
    );
    const secondPath = await writeDefinition(
      globalAgentsDir(roots),
      "product-manager.yaml",
      [
        "name: product-manager",
        "description: second yaml pm",
        "persona: second yaml persona",
        "prompt: second yaml prompt",
        "",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(firstPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(secondPath);
  });

  it("rejects bundled duplicate YAML definitions with different filenames", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const primaryPath = await writeDefinition(
      roots.bundledDir,
      "product-manager.yml",
      [
        "name: product-manager",
        "description: primary product manager",
        "persona: primary persona",
        "prompt: primary prompt",
        "",
      ].join("\n"),
    );
    const duplicatePath = await writeDefinition(
      roots.bundledDir,
      "pm-backup.yml",
      [
        "name: product-manager",
        "description: duplicate product manager",
        "persona: duplicate persona",
        "prompt: duplicate prompt",
        "",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(primaryPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(duplicatePath);
  });

  it("rejects bundled duplicate .yaml definitions with different filenames", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const firstPath = await writeDefinition(
      roots.bundledDir,
      "pm.yaml",
      [
        "name: product-manager",
        "description: first yaml pm",
        "persona: first yaml persona",
        "prompt: first yaml prompt",
        "",
      ].join("\n"),
    );
    const secondPath = await writeDefinition(
      roots.bundledDir,
      "product-manager.yaml",
      [
        "name: product-manager",
        "description: second yaml pm",
        "persona: second yaml persona",
        "prompt: second yaml prompt",
        "",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(firstPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(secondPath);
  });

  it("rejects global same-directory name collisions across YAML extensions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const ymlPath = await writeDefinition(
      globalAgentsDir(roots),
      "pm.yml",
      [
        "name: product-manager",
        "description: yml pm",
        "persona: yml persona",
        "prompt: yml prompt",
        "",
      ].join("\n"),
    );
    const yamlPath = await writeDefinition(
      globalAgentsDir(roots),
      "pm.yaml",
      [
        "name: product-manager",
        "description: yaml pm",
        "persona: yaml persona",
        "prompt: yaml prompt",
        "",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(ymlPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(yamlPath);
  });

  it("rejects bundled same-directory name collisions across YAML extensions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);
    const ymlPath = await writeDefinition(
      roots.bundledDir,
      "pm.yml",
      [
        "name: product-manager",
        "description: yml pm",
        "persona: yml persona",
        "prompt: yml prompt",
        "",
      ].join("\n"),
    );
    const yamlPath = await writeDefinition(
      roots.bundledDir,
      "pm.yaml",
      [
        "name: product-manager",
        "description: yaml pm",
        "persona: yaml persona",
        "prompt: yaml prompt",
        "",
      ].join("\n"),
    );

    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(/duplicate agent definition/);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(ymlPath);
    await expect(
      loadAgentRegistry({
        cwd: roots.cwd,
        homeDir: roots.homeDir,
        bundledDir: roots.bundledDir,
      }),
    ).rejects.toThrow(yamlPath);
  });

  it("preserves unknown frontmatter fields on markdown definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      projectAgentsDir(roots),
      "orchestrator.md",
      [
        "---",
        "name: orchestrator",
        "description: orchestrator agent",
        "persona: You coordinate the swarm.",
        "tone: precise",
        "---",
        "",
        "Produce the orchestrator prompt.",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("orchestrator")).toMatchObject({
      tone: "precise",
    });
  });

  it("preserves unknown fields on yaml definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      projectAgentsDir(roots),
      "scribe.yml",
      [
        "name: scribe",
        "description: scribe agent",
        "persona: You capture decisions precisely.",
        "prompt: Produce the meeting notes.",
        "tone: concise",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("scribe")).toMatchObject({
      tone: "concise",
    });
  });

  it("preserves unknown fields on global markdown definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      globalAgentsDir(roots),
      "moderator.md",
      [
        "---",
        "name: moderator",
        "description: moderator agent",
        "persona: You keep the conversation focused.",
        "tone: steady",
        "---",
        "",
        "Produce the moderated next step.",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("moderator")).toMatchObject({
      tone: "steady",
    });
  });

  it("preserves unknown fields on bundled markdown definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "operator.md",
      [
        "---",
        "name: operator",
        "description: operator agent",
        "persona: You coordinate execution.",
        "tone: crisp",
        "---",
        "",
        "Produce the operator next step.",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("operator")).toMatchObject({
      tone: "crisp",
    });
  });

  it("preserves unknown fields on global yaml definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      globalAgentsDir(roots),
      "facilitator.yml",
      [
        "name: facilitator",
        "description: facilitator agent",
        "persona: You keep the room aligned.",
        "prompt: Produce the facilitation next step.",
        "tone: direct",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("facilitator")).toMatchObject({
      tone: "direct",
    });
  });

  it("preserves unknown fields on bundled yaml definitions", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "operator.yml",
      [
        "name: operator",
        "description: operator agent",
        "persona: You coordinate execution.",
        "prompt: Produce the operator next step.",
        "tone: crisp",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("operator")).toMatchObject({
      tone: "crisp",
    });
  });

  it("resolves prompt.file relative to the definition file", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      projectAgentsDir(roots),
      "analyst.md",
      [
        "---",
        "name: analyst",
        "description: analyst agent",
        "persona: You inspect evidence.",
        "prompt:",
        "  file: prompts/analyst.md",
        "---",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("analyst")).toMatchObject({
      prompt: {
        file: path.join(projectAgentsDir(roots), "prompts", "analyst.md"),
      },
    });
  });

  it("resolves global markdown prompt.file relative to the definition file", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      globalAgentsDir(roots),
      "reviewer.md",
      [
        "---",
        "name: reviewer",
        "description: reviewer agent",
        "persona: You inspect proposed changes.",
        "prompt:",
        "  file: prompts/reviewer.md",
        "---",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("reviewer")).toMatchObject({
      prompt: {
        file: path.join(globalAgentsDir(roots), "prompts", "reviewer.md"),
      },
    });
  });

  it("resolves bundled markdown prompt.file relative to the definition file", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "planner.md",
      [
        "---",
        "name: planner",
        "description: planner agent",
        "persona: You sequence the work.",
        "prompt:",
        "  file: prompts/planner.md",
        "---",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("planner")).toMatchObject({
      prompt: {
        file: path.join(roots.bundledDir, "prompts", "planner.md"),
      },
    });
  });

  it("resolves yaml prompt.file relative to the definition file", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      projectAgentsDir(roots),
      "researcher.yml",
      [
        "name: researcher",
        "description: researcher agent",
        "persona: You synthesize sources.",
        "prompt:",
        "  file: prompts/researcher.md",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("researcher")).toMatchObject({
      prompt: {
        file: path.join(projectAgentsDir(roots), "prompts", "researcher.md"),
      },
    });
  });

  it("resolves global yaml prompt.file relative to the definition file", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      globalAgentsDir(roots),
      "writer.yml",
      [
        "name: writer",
        "description: writer agent",
        "persona: You shape the final narrative.",
        "prompt:",
        "  file: prompts/writer.md",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("writer")).toMatchObject({
      prompt: {
        file: path.join(globalAgentsDir(roots), "prompts", "writer.md"),
      },
    });
  });

  it("resolves bundled yaml prompt.file relative to the definition file", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    await writeDefinition(
      roots.bundledDir,
      "operator.yml",
      [
        "name: operator",
        "description: operator agent",
        "persona: You coordinate execution details.",
        "prompt:",
        "  file: prompts/operator.md",
        "",
      ].join("\n"),
    );

    const registry = await loadAgentRegistry({
      cwd: roots.cwd,
      homeDir: roots.homeDir,
      bundledDir: roots.bundledDir,
    });

    expect(registry.getAgent("operator")).toMatchObject({
      prompt: {
        file: path.join(roots.bundledDir, "prompts", "operator.md"),
      },
    });
  });

  it("loads bundled fallback agents from the default bundled directory", async () => {
    const roots = await makeTempRoots();
    cleanupDirs.push(roots.rootDir);

    const registry = await loadAgentRegistry({
      cwd: path.join(roots.rootDir, "empty-cwd"),
      homeDir: path.join(roots.rootDir, "empty-home"),
    });

    expect(registry.getAgent("product-manager")).toMatchObject({
      name: "product-manager",
    });
    expect(registry.getAgent("principal-engineer")).toMatchObject({
      name: "principal-engineer",
    });
  });
});
