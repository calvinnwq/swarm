import type { BackendId } from "../schemas/backend-id.js";
import type { ResolveMode } from "../schemas/index.js";

export const DEFAULT_DISPATCH_TIMEOUT_MS = 120_000;

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
  timeoutMs: number;
  goal: string | null;
  decision: string | null;
  docs: string[];
  commandText: string;
}
