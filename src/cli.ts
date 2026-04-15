import { readFileSync } from "node:fs";
import process from "node:process";
import { Command, InvalidArgumentError } from "commander";
import {
  buildConfig,
  runSwarm,
  SwarmCommandError,
} from "./lib/index.js";

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
  .option("--preset <name>", "named preset (pass-through; not yet resolved)")
  .action(async (rounds: number, topic: string[], options: Record<string, unknown>) => {
    try {
      const config = buildConfig({
        rounds,
        topic,
        agents: options.agents as string | undefined,
        resolve: options.resolve as string | undefined,
        goal: options.goal as string | undefined,
        decision: options.decision as string | undefined,
        docs: options.doc as string[] | undefined,
        preset: options.preset as string | undefined,
        commandText: process.argv.slice(2).join(" "),
      });
      const exitCode = await runSwarm(config);
      process.exit(exitCode);
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
