import { readFileSync } from "node:fs";
import process from "node:process";
import { Command, InvalidArgumentError } from "commander";
import {
  assertResolvedRuntimesAvailable,
  buildConfig,
  formatDoctorReport,
  loadAgentRegistry,
  loadPresetRegistry,
  loadProjectConfig,
  resolveAgentRuntimes,
  resolvePresetByName,
  runDoctor,
  runSwarm,
  SwarmCommandError,
  type AgentSelectionSource,
} from "./lib/index.js";
import {
  buildHarnessAdapterRegistry,
  createAgentAdapterResolver,
  createAgentRuntimeResolver,
  createBackendAdapter,
} from "./backends/index.js";

const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
).version as string;

function collectDoc(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function parseRoundsArg(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new InvalidArgumentError("rounds must be an integer");
  }
  return parsed;
}

const program = new Command();

program
  .name("swarm")
  .description(
    "Fan out agents in parallel rounds, collect structured output, synthesize.",
  )
  .version(packageVersion);

program
  .command("run", { isDefault: true })
  .description("Run a swarm")
  .argument("<rounds>", "number of rounds (1–3)", parseRoundsArg)
  .argument("<topic...>", "topic for the swarm")
  .option("--agents <list>", "comma-separated agent names")
  .option(
    "--resolve <mode>",
    "record resolution mode in manifest: off | orchestrator | agents (mode-specific resolution is stubbed)",
  )
  .option("--goal <text>", "primary goal for the swarm")
  .option("--decision <text>", "decision target for the swarm")
  .option("--doc <path>", "carry-forward document (repeatable)", collectDoc, [])
  .option(
    "--preset <name>",
    "named preset (resolves to agents when --agents not provided)",
  )
  .option(
    "--backend <name>",
    "runtime backend adapter (currently: claude, codex)",
  )
  .option(
    "--quiet",
    "force quiet (one-line-per-event) output; default auto by TTY",
  )
  .action(
    async (
      rounds: number,
      topic: string[],
      options: Record<string, unknown>,
    ) => {
      try {
        const loadedProjectConfig = await loadProjectConfig();
        const projectConfig = loadedProjectConfig?.config ?? {};
        const cliDocs = options.doc as string[] | undefined;
        const cliAgents = options.agents as string | undefined;
        const configAgents = projectConfig.agents?.join(",");
        const cliPresetName = options.preset as string | undefined;
        const configPresetName = projectConfig.preset;
        const cliBackend = options.backend as string | undefined;
        const configBackend = projectConfig.backend;

        let resolvedAgents: string | undefined = cliAgents;
        const resolvedBackend = cliBackend ?? configBackend;
        let resolvedResolve =
          (options.resolve as string | undefined) ?? projectConfig.resolve;
        let resolvedGoal =
          (options.goal as string | undefined) ?? projectConfig.goal;
        let resolvedDecision =
          (options.decision as string | undefined) ?? projectConfig.decision;
        let resolvedPresetName: string | undefined;
        let selectionSource: AgentSelectionSource | undefined;

        if (cliAgents === undefined && cliPresetName !== undefined) {
          const preset = await resolvePresetByName(cliPresetName);
          resolvedAgents = preset.agents.join(",");
          resolvedPresetName = cliPresetName;
          selectionSource = "preset";
          resolvedResolve = resolvedResolve ?? preset.resolve;
          resolvedGoal = resolvedGoal ?? preset.goal;
          resolvedDecision = resolvedDecision ?? preset.decision;
        } else if (resolvedAgents === undefined && configAgents !== undefined) {
          resolvedAgents = configAgents;
        } else if (
          resolvedAgents === undefined &&
          configPresetName !== undefined
        ) {
          const presetRegistry = await loadPresetRegistry();
          const preset = presetRegistry.getPreset(configPresetName);
          resolvedAgents = preset.agents.join(",");
          resolvedPresetName = configPresetName;
          selectionSource = "preset";
          resolvedResolve = resolvedResolve ?? preset.resolve;
          resolvedGoal = resolvedGoal ?? preset.goal;
          resolvedDecision = resolvedDecision ?? preset.decision;
        }

        const config = buildConfig({
          rounds,
          topic,
          agents: resolvedAgents,
          backend: resolvedBackend,
          resolve: resolvedResolve,
          goal: resolvedGoal,
          decision: resolvedDecision,
          docs:
            cliDocs && cliDocs.length > 0
              ? cliDocs
              : (projectConfig.docs ?? []),
          preset: resolvedPresetName,
          selectionSource,
          commandText: process.argv.slice(2).join(" "),
        });
        const registry = await loadAgentRegistry();
        const agents = config.agents.map((name) => registry.getAgent(name));
        const resolved = resolveAgentRuntimes(agents, config.backend);
        assertResolvedRuntimesAvailable(resolved);
        const harnessRegistry = buildHarnessAdapterRegistry(resolved);
        const resolveBackend = createAgentAdapterResolver(
          resolved,
          harnessRegistry,
        );
        const resolveRuntime = createAgentRuntimeResolver(resolved);
        const backend = createBackendAdapter(config.backend);
        const ui = options.quiet === true ? "quiet" : undefined;
        const exitCode = await runSwarm({
          config,
          agents,
          backend,
          ui,
          resolveBackend,
          resolveRuntime,
          agentRuntimes: resolved,
        });
        process.exit(exitCode);
      } catch (err) {
        if (err instanceof SwarmCommandError) {
          process.stderr.write(`swarm: ${err.message}\n`);
          process.exit(2);
        }
        throw err;
      }
    },
  );

program
  .command("doctor")
  .description(
    "Diagnose swarm setup: config, agents, presets, and harness capability",
  )
  .action(async () => {
    try {
      const report = await runDoctor();
      process.stdout.write(`${formatDoctorReport(report)}\n`);
      process.exit(report.ok ? 0 : 1);
    } catch (err) {
      if (err instanceof SwarmCommandError) {
        process.stderr.write(`swarm: ${err.message}\n`);
        process.exit(2);
      }
      throw err;
    }
  });

try {
  await program.parseAsync();
} catch (err) {
  process.stderr.write(
    `\n  swarm: ${err instanceof Error ? err.message : String(err)}\n\n`,
  );
  process.exit(1);
}
