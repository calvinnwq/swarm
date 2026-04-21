import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";
import { AgentDefinitionSchema, type AgentDefinition } from "../schemas/index.js";
import { SwarmCommandError } from "./parse-command.js";

const DEFINITION_EXTENSIONS = new Set([".yml", ".yaml", ".md"]);
const DEFAULT_BUNDLED_DIR_CANDIDATES = [
  fileURLToPath(new URL("./agents/bundled", import.meta.url)),
  fileURLToPath(new URL("../agents/bundled", import.meta.url)),
  fileURLToPath(new URL("../src/agents/bundled", import.meta.url)),
];

export interface LoadAgentRegistryOptions {
  cwd?: string;
  homeDir?: string;
  bundledDir?: string;
}

export interface AgentRegistry {
  getAgent(name: string): AgentDefinition;
  listAgents(): AgentDefinition[];
  searchedRoots: string[];
}

interface RootDefinition {
  definition: AgentDefinition;
  filePath: string;
}

export async function loadAgentRegistry(
  options: LoadAgentRegistryOptions = {},
): Promise<AgentRegistry> {
  const bundledDir = options.bundledDir
    ? path.resolve(options.bundledDir)
    : await resolveDefaultBundledDir();
  const searchedRoots = [
    path.join(path.resolve(options.cwd ?? process.cwd()), ".swarm", "agents"),
    path.join(path.resolve(options.homeDir ?? homedir()), ".swarm", "agents"),
    bundledDir,
  ];

  const definitions = new Map<string, AgentDefinition>();

  for (const root of searchedRoots) {
    const rootDefinitions = await loadDefinitionsFromRoot(root);
    for (const { definition } of rootDefinitions) {
      if (!definitions.has(definition.name)) {
        definitions.set(definition.name, definition);
      }
    }
  }

  return {
    searchedRoots,
    listAgents(): AgentDefinition[] {
      return Array.from(definitions.values());
    },
    getAgent(name: string): AgentDefinition {
      const normalizedName = name.trim().toLowerCase();
      const definition = definitions.get(normalizedName);
      if (definition) {
        return definition;
      }

      throw new SwarmCommandError(
        `unknown agent "${normalizedName}" (searched: ${searchedRoots.join(", ")})`,
      );
    },
  };
}

async function resolveDefaultBundledDir(): Promise<string> {
  for (const candidate of DEFAULT_BUNDLED_DIR_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return DEFAULT_BUNDLED_DIR_CANDIDATES[1];
}

async function loadDefinitionsFromRoot(root: string): Promise<RootDefinition[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectory(error)) {
      return [];
    }
    throw error;
  }

  const fileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => DEFINITION_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort((left, right) => left.localeCompare(right));

  const definitions: RootDefinition[] = [];
  const seenNames = new Map<string, string>();

  for (const fileName of fileNames) {
    const filePath = path.join(root, fileName);
    const definition = await loadDefinitionFile(filePath);
    const existingPath = seenNames.get(definition.name);
    if (existingPath) {
      throw new SwarmCommandError(
        `duplicate agent definition "${definition.name}" in ${root}: ${existingPath} and ${filePath}`,
      );
    }

    seenNames.set(definition.name, filePath);
    definitions.push({ definition, filePath });
  }

  return definitions;
}

async function loadDefinitionFile(filePath: string): Promise<AgentDefinition> {
  const raw = await readFile(filePath, "utf-8");
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".md") {
    return parseMarkdownDefinition(raw, filePath);
  }

  return parseYamlDefinition(raw, filePath);
}

function parseYamlDefinition(raw: string, filePath: string): AgentDefinition {
  const loaded = parseYamlDocument(raw, filePath, "YAML");
  return validateDefinition(loaded, filePath);
}

function parseMarkdownDefinition(raw: string, filePath: string): AgentDefinition {
  const { frontmatter, body } = splitFrontmatter(raw, filePath);
  const loaded = parseYamlDocument(frontmatter, filePath, "frontmatter");

  if (!isRecord(loaded)) {
    return validateDefinition(loaded, filePath);
  }

  if ("prompt" in loaded) {
    if (body.trim().length > 0) {
      throw new SwarmCommandError(
        `markdown definition cannot include both frontmatter prompt and body content: ${filePath}`,
      );
    }
    return validateDefinition(loaded, filePath);
  }

  const prompt = body.trim();
  if (!prompt) {
    throw new SwarmCommandError(
      `markdown definition must provide a prompt in frontmatter or body: ${filePath}`,
    );
  }

  return validateDefinition({ ...loaded, prompt }, filePath);
}

function splitFrontmatter(raw: string, filePath: string): { frontmatter: string; body: string } {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new SwarmCommandError(`markdown definition is missing frontmatter fence: ${filePath}`);
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex === -1) {
    throw new SwarmCommandError(`markdown definition is missing closing frontmatter fence: ${filePath}`);
  }

  return {
    frontmatter: lines.slice(1, endIndex).join("\n"),
    body: lines.slice(endIndex + 1).join("\n"),
  };
}

function parseYamlDocument(raw: string, filePath: string, label: string): unknown {
  try {
    return loadYaml(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SwarmCommandError(`failed to parse ${label} in ${filePath}: ${message}`);
  }
}

function validateDefinition(input: unknown, filePath: string): AgentDefinition {
  const parsed = AgentDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    throw new SwarmCommandError(
      `invalid agent definition in ${filePath}: ${parsed.error.message}`,
    );
  }

  if (typeof parsed.data.prompt === "string") {
    return parsed.data;
  }

  return {
    ...parsed.data,
    prompt: {
      file: path.resolve(path.dirname(filePath), parsed.data.prompt.file),
    },
  };
}

function isMissingDirectory(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
