import { readFileSync } from "node:fs";
import process from "node:process";
import { Command, InvalidArgumentError } from "commander";
import {
  buildConfig,
  loadAgentRegistry,
  loadPresetRegistry,
  loadProjectConfig,
  runSwarm,
  SwarmCommandError,
  type AgentSelectionSource,
} from "./lib/index.js";
import { ClaudeCliAdapter } from "./backends/claude-cli.js";

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
  .option("--resolve <mode>", "resolution mode: off | orchestrator | agents")
  .option("--goal <text>", "primary goal for the swarm")
  .option("--decision <text>", "decision target for the swarm")
  .option("--doc <path>", "carry-forward document (repeatable)", collectDoc, [])
  .option(
    "--preset <name>",
    "named preset (resolves to agents when --agents not provided)",
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
        const explicitAgents =
          (options.agents as string | undefined) ??
          (projectConfig.agents ? projectConfig.agents.join(",") : undefined);
        const presetName =
          (options.preset as string | undefined) ?? projectConfig.preset;

        let resolvedAgents: string | undefined = explicitAgents;
        let resolvedResolve =
          (options.resolve as string | undefined) ?? projectConfig.resolve;
        let resolvedGoal =
          (options.goal as string | undefined) ?? projectConfig.goal;
        let resolvedDecision =
          (options.decision as string | undefined) ?? projectConfig.decision;
        let selectionSource: AgentSelectionSource | undefined;

        if (explicitAgents === undefined && presetName !== undefined) {
          const presetRegistry = await loadPresetRegistry();
          const preset = presetRegistry.getPreset(presetName);
          resolvedAgents = preset.agents.join(",");
          selectionSource = "preset";
          resolvedResolve = resolvedResolve ?? preset.resolve;
          resolvedGoal = resolvedGoal ?? preset.goal;
          resolvedDecision = resolvedDecision ?? preset.decision;
        }

        const config = buildConfig({
          rounds,
          topic,
          agents: resolvedAgents,
          resolve: resolvedResolve,
          goal: resolvedGoal,
          decision: resolvedDecision,
          docs:
            cliDocs && cliDocs.length > 0
              ? cliDocs
              : (projectConfig.docs ?? []),
          preset: presetName,
          selectionSource,
          commandText: process.argv.slice(2).join(" "),
        });
        const registry = await loadAgentRegistry();
        const agents = config.agents.map((name) => registry.getAgent(name));
        const backend = new ClaudeCliAdapter();
        const exitCode = await runSwarm({ config, agents, backend });
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

try {
  await program.parseAsync();
} catch (err) {
  process.stderr.write(
    `\n  swarm: ${err instanceof Error ? err.message : String(err)}\n\n`,
  );
  process.exit(1);
}
