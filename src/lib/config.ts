import type { BackendId } from "../schemas/backend-id.js";
import type { ResolveMode } from "../schemas/index.js";

export type AgentSelectionSource =
  | "explicit-agents"
  | "preset"
  | "default-preset";

export interface SwarmRunConfig {
  topic: string;
  rounds: number;
  backend: BackendId;
  preset: string | null;
  agents: string[];
  selectionSource: AgentSelectionSource;
  resolveMode: ResolveMode;
  goal: string | null;
  decision: string | null;
  docs: string[];
  commandText: string;
}
