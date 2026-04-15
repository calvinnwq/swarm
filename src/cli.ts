import { readFileSync } from "node:fs";
import process from "node:process";
import { Command } from "commander";

const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
).version as string;

const program = new Command();

program
  .name("swarm")
  .description(
    "Fan out agents in parallel rounds, collect structured output, synthesize.",
  )
  .version(packageVersion);

program
  .command("run", { isDefault: true })
  .description("Run a swarm (not yet implemented)")
  .argument("[topic...]", "Topic for the swarm")
  .action((topic: string[]) => {
    const joined = topic.join(" ").trim();
    if (!joined) {
      program.help();
      return;
    }
    console.error(`swarm: not yet implemented — topic was: ${joined}`);
    process.exit(2);
  });

try {
  await program.parseAsync();
} catch (err) {
  console.error(`\n  swarm: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
