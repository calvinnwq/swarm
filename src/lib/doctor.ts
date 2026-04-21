import {
  loadAgentRegistry,
  type AgentRegistry,
  type LoadAgentRegistryOptions,
} from "./agent-registry.js";
import {
  loadPresetRegistry,
  type LoadPresetRegistryOptions,
  type PresetRegistry,
} from "./preset-registry.js";
import {
  loadProjectConfig,
  PROJECT_CONFIG_RELATIVE_PATH,
  type LoadedProjectConfig,
  type LoadProjectConfigOptions,
} from "./load-project-config.js";
import { SwarmCommandError } from "./parse-command.js";

export type DoctorCheckStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorCheckStatus;
  message: string;
  detail?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface RunDoctorOptions {
  cwd?: string;
  homeDir?: string;
  bundledAgentsDir?: string;
  bundledPresetsDir?: string;
}

export async function runDoctor(
  options: RunDoctorOptions = {},
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  const projectConfigCheck = await checkProjectConfig({
    cwd: options.cwd,
  });
  checks.push(projectConfigCheck.check);
  const loadedConfig = projectConfigCheck.loaded;

  const agentRegistryCheck = await checkAgentRegistry({
    cwd: options.cwd,
    homeDir: options.homeDir,
    bundledDir: options.bundledAgentsDir,
  });
  checks.push(agentRegistryCheck.check);
  const agentRegistry = agentRegistryCheck.registry;

  const presetRegistryCheck = await checkPresetRegistry({
    cwd: options.cwd,
    homeDir: options.homeDir,
    bundledDir: options.bundledPresetsDir,
  });
  checks.push(presetRegistryCheck.check);
  const presetRegistry = presetRegistryCheck.registry;

  if (loadedConfig?.config.agents && agentRegistry) {
    checks.push(checkConfigAgents(loadedConfig.config.agents, agentRegistry));
  }

  if (
    loadedConfig?.config.preset &&
    presetRegistry &&
    !loadedConfig.config.agents
  ) {
    checks.push(
      checkConfigPreset(
        loadedConfig.config.preset,
        presetRegistry,
        agentRegistry,
      ),
    );
  }

  const ok = checks.every((c) => c.status !== "fail");
  return { ok, checks };
}

async function checkProjectConfig(
  options: LoadProjectConfigOptions,
): Promise<{ check: DoctorCheck; loaded: LoadedProjectConfig | null }> {
  try {
    const loaded = await loadProjectConfig(options);
    if (!loaded) {
      return {
        loaded: null,
        check: {
          name: "project config",
          status: "ok",
          message: `no ${PROJECT_CONFIG_RELATIVE_PATH} (CLI flags only)`,
        },
      };
    }
    return {
      loaded,
      check: {
        name: "project config",
        status: "ok",
        message: `loaded ${PROJECT_CONFIG_RELATIVE_PATH}`,
        detail: loaded.filePath,
      },
    };
  } catch (error) {
    return {
      loaded: null,
      check: {
        name: "project config",
        status: "fail",
        message: errorMessage(error),
      },
    };
  }
}

async function checkAgentRegistry(
  options: LoadAgentRegistryOptions,
): Promise<{ check: DoctorCheck; registry: AgentRegistry | null }> {
  try {
    const registry = await loadAgentRegistry(options);
    const count = registry.listAgents().length;
    return {
      registry,
      check: {
        name: "agent registry",
        status: count > 0 ? "ok" : "fail",
        message:
          count > 0
            ? `loaded ${count} agent(s) from ${registry.searchedRoots.length} root(s)`
            : `loaded 0 agents from ${registry.searchedRoots.length} root(s)`,
        detail: registry.searchedRoots.join("\n"),
      },
    };
  } catch (error) {
    return {
      registry: null,
      check: {
        name: "agent registry",
        status: "fail",
        message: errorMessage(error),
      },
    };
  }
}

async function checkPresetRegistry(
  options: LoadPresetRegistryOptions,
): Promise<{ check: DoctorCheck; registry: PresetRegistry | null }> {
  try {
    const registry = await loadPresetRegistry(options);
    const count = registry.listPresets().length;
    return {
      registry,
      check: {
        name: "preset registry",
        status: count > 0 ? "ok" : "fail",
        message:
          count > 0
            ? `loaded ${count} preset(s) from ${registry.searchedRoots.length} root(s)`
            : `loaded 0 presets from ${registry.searchedRoots.length} root(s)`,
        detail: registry.searchedRoots.join("\n"),
      },
    };
  } catch (error) {
    return {
      registry: null,
      check: {
        name: "preset registry",
        status: "fail",
        message: errorMessage(error),
      },
    };
  }
}

function checkConfigAgents(
  agents: string[],
  registry: AgentRegistry,
): DoctorCheck {
  const missing: string[] = [];
  for (const name of agents) {
    try {
      registry.getAgent(name);
    } catch {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    return {
      name: "config agents",
      status: "fail",
      message: `unknown agent(s) referenced in config: ${missing.join(", ")}`,
      detail: `searched: ${registry.searchedRoots.join(", ")}`,
    };
  }
  return {
    name: "config agents",
    status: "ok",
    message: `all ${agents.length} config agent(s) resolve`,
  };
}

function checkConfigPreset(
  presetName: string,
  presetRegistry: PresetRegistry,
  agentRegistry: AgentRegistry | null,
): DoctorCheck {
  let preset;
  try {
    preset = presetRegistry.getPreset(presetName);
  } catch (error) {
    return {
      name: "config preset",
      status: "fail",
      message: errorMessage(error),
    };
  }

  if (agentRegistry) {
    const missing: string[] = [];
    for (const name of preset.agents) {
      try {
        agentRegistry.getAgent(name);
      } catch {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      return {
        name: "config preset",
        status: "fail",
        message: `preset "${preset.name}" references unknown agent(s): ${missing.join(", ")}`,
      };
    }
  }

  return {
    name: "config preset",
    status: "ok",
    message: `preset "${preset.name}" resolves (${preset.agents.length} agent(s))`,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof SwarmCommandError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  for (const check of report.checks) {
    const marker =
      check.status === "ok" ? "OK" : check.status === "warn" ? "WARN" : "FAIL";
    lines.push(`[${marker}] ${check.name}: ${check.message}`);
    if (check.detail) {
      for (const detailLine of check.detail.split("\n")) {
        lines.push(`        ${detailLine}`);
      }
    }
  }
  lines.push("");
  lines.push(
    report.ok ? "swarm doctor: ready" : "swarm doctor: problems found",
  );
  return lines.join("\n");
}
