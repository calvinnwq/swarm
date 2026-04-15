import type { SwarmRunConfig } from "./config.js";

export async function runSwarm(config: SwarmRunConfig): Promise<number> {
  const summary = [
    `topic="${config.topic}"`,
    `rounds=${config.rounds}`,
    `agents=${config.agents.join(",")}`,
    `resolve=${config.resolveMode}`,
    config.preset ? `preset=${config.preset}` : null,
    config.goal ? `goal="${config.goal}"` : null,
    config.decision ? `decision="${config.decision}"` : null,
    config.docs.length > 0 ? `docs=${config.docs.length}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  process.stderr.write(`swarm: ${summary}\n`);
  process.stderr.write("swarm: execution not yet implemented (NGX-73)\n");
  return 0;
}
