import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { load as loadYaml } from "js-yaml";
import {
  SwarmProjectConfigSchema,
  type SwarmProjectConfig,
} from "../schemas/index.js";
import { SwarmCommandError } from "./parse-command.js";

export const PROJECT_CONFIG_RELATIVE_PATH = ".swarm/config.yml";

export interface LoadProjectConfigOptions {
  cwd?: string;
}

export interface LoadedProjectConfig {
  config: SwarmProjectConfig;
  filePath: string;
}

export async function loadProjectConfig(
  options: LoadProjectConfigOptions = {},
): Promise<LoadedProjectConfig | null> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const filePath = path.join(cwd, PROJECT_CONFIG_RELATIVE_PATH);

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new SwarmCommandError(
      `failed to read ${PROJECT_CONFIG_RELATIVE_PATH}: ${message}`,
    );
  }

  let loaded: unknown;
  try {
    loaded = loadYaml(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SwarmCommandError(
      `invalid YAML in ${PROJECT_CONFIG_RELATIVE_PATH}: ${message}`,
    );
  }

  if (loaded === null || loaded === undefined) {
    return { config: {}, filePath };
  }

  const parsed = SwarmProjectConfigSchema.safeParse(loaded);
  if (!parsed.success) {
    throw new SwarmCommandError(
      `invalid ${PROJECT_CONFIG_RELATIVE_PATH}:\n${formatZodError(parsed.error)}`,
    );
  }

  return { config: parsed.data, filePath };
}

function formatZodError(error: import("zod").ZodError): string {
  return error.issues
    .map((issue) => {
      const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  - ${pathLabel}: ${issue.message}`;
    })
    .join("\n");
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
