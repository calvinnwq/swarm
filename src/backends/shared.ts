import { readFile } from "node:fs/promises";
import type { AgentDefinition } from "../schemas/index.js";

export async function resolveAgentPrompt(
  agent: AgentDefinition,
): Promise<string> {
  if (typeof agent.prompt === "string") {
    return agent.prompt;
  }

  return await readFile(agent.prompt.file, "utf-8");
}

export function joinPromptSections(...sections: string[]): string {
  return sections
    .map((section) => section.trim())
    .filter(Boolean)
    .join("\n\n");
}
