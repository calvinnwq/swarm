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
    ).rejects.toThrow(filePath);
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
    ).rejects.toThrow(filePath);
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
