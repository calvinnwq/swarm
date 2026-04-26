import {
  loadAgentRegistry,
  type AgentRegistry,
  type LoadAgentRegistryOptions,
} from "./agent-registry.js";
import { collectAgentBackendMismatches } from "./backend-selection.js";
import { checkHarnessCapability } from "./harness-capability.js";
import {
  backendToHarness,
  resolveAgentRuntimes,
} from "./harness-resolution.js";
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
import type { AgentDefinition } from "../schemas/index.js";
import type { BackendId } from "../schemas/backend-id.js";
import type { HarnessId } from "../schemas/harness-id.js";
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
  env?: NodeJS.ProcessEnv;
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

  if (loadedConfig && agentRegistry) {
    const configBackendCheck = checkConfigBackend(
      loadedConfig.config,
      agentRegistry,
      presetRegistry,
    );
    if (configBackendCheck) {
      checks.push(configBackendCheck);
    }
  }

  if (loadedConfig) {
    const harnesses = resolveDoctorHarnesses(
      loadedConfig.config,
      agentRegistry,
      presetRegistry,
    );
    for (const harness of harnesses) {
      checks.push(
        await checkHarnessCapability(harness, {
          env: options.env,
        }),
      );
    }
  }

  const ok = checks.every((c) => c.status !== "fail");
  return { ok, checks };
}

async function checkProjectConfig(options: LoadProjectConfigOptions): Promise<{
  check: DoctorCheck;
  loaded: LoadedProjectConfig | null;
  state: "missing" | "loaded" | "invalid";
}> {
  try {
    const loaded = await loadProjectConfig(options);
    if (!loaded) {
      return {
        loaded: null,
        state: "missing",
        check: {
          name: "project config",
          status: "ok",
          message: `no ${PROJECT_CONFIG_RELATIVE_PATH} (CLI flags only)`,
        },
      };
    }
    return {
      loaded,
      state: "loaded",
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
      state: "invalid",
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

function checkConfigBackend(
  config: LoadedProjectConfig["config"],
  agentRegistry: AgentRegistry,
  presetRegistry: PresetRegistry | null,
): DoctorCheck | null {
  const backend = config.backend ?? "claude";

  if (config.agents) {
    const agents = resolveAgents(config.agents, agentRegistry);
    if (!agents) {
      return null;
    }
    return buildConfigBackendCheck(backend, agents, {
      okMessage: `backend "${backend}" matches all ${agents.length} config agent(s)`,
      mismatchPrefix: `backend "${backend}" does not match config agent backend(s)`,
    });
  }

  if (config.preset) {
    if (!presetRegistry) {
      return null;
    }

    let preset;
    try {
      preset = presetRegistry.getPreset(config.preset);
    } catch {
      return null;
    }

    const agents = resolveAgents(preset.agents, agentRegistry);
    if (!agents) {
      return null;
    }

    return buildConfigBackendCheck(backend, agents, {
      okMessage: `backend "${backend}" matches preset "${preset.name}" (${agents.length} agent(s))`,
      mismatchPrefix: `backend "${backend}" does not match preset "${preset.name}" agent backend(s)`,
    });
  }

  if (config.backend) {
    return {
      name: "config backend",
      status: "ok",
      message: `backend "${backend}" is supported`,
    };
  }

  return null;
}

function buildConfigBackendCheck(
  backend: BackendId,
  agents: AgentDefinition[],
  messages: { okMessage: string; mismatchPrefix: string },
): DoctorCheck {
  const mismatches = collectAgentBackendMismatches(backend, agents);
  if (mismatches.length > 0) {
    return {
      name: "config backend",
      status: "fail",
      message: `${messages.mismatchPrefix}: ${formatBackendMismatches(mismatches)}`,
    };
  }

  return {
    name: "config backend",
    status: "ok",
    message: messages.okMessage,
  };
}

function resolveDoctorHarnesses(
  config: LoadedProjectConfig["config"],
  agentRegistry: AgentRegistry | null,
  presetRegistry: PresetRegistry | null,
): HarnessId[] {
  const backend = config.backend ?? "claude";
  const agents = resolveConfiguredAgents(config, agentRegistry, presetRegistry);
  if (!agents) {
    return [backendToHarness(backend)];
  }

  return [
    ...new Set(
      resolveAgentRuntimes(agents, backend).map((runtime) => runtime.harness),
    ),
  ];
}

function resolveConfiguredAgents(
  config: LoadedProjectConfig["config"],
  agentRegistry: AgentRegistry | null,
  presetRegistry: PresetRegistry | null,
): AgentDefinition[] | null {
  if (!agentRegistry) {
    return null;
  }

  if (config.agents) {
    return resolveAgents(config.agents, agentRegistry);
  }

  if (config.preset && presetRegistry) {
    try {
      return resolveAgents(
        presetRegistry.getPreset(config.preset).agents,
        agentRegistry,
      );
    } catch {
      return null;
    }
  }

  return null;
}

function resolveAgents(
  names: string[],
  registry: AgentRegistry,
): AgentDefinition[] | null {
  const agents: AgentDefinition[] = [];
  for (const name of names) {
    try {
      agents.push(registry.getAgent(name));
    } catch {
      return null;
    }
  }
  return agents;
}

function formatBackendMismatches(
  mismatches: ReturnType<typeof collectAgentBackendMismatches>,
): string {
  return mismatches
    .map((mismatch) => `${mismatch.agentName} (${mismatch.agentBackend})`)
    .join(", ");
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
