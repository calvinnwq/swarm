import { BackendIdSchema, type BackendId } from "../schemas/backend-id.js";
import { ResolveModeSchema, type ResolveMode } from "../schemas/index.js";
import {
  DEFAULT_DISPATCH_TIMEOUT_MS,
  type AgentSelectionSource,
  type SwarmRunConfig,
} from "./config.js";

export class SwarmCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SwarmCommandError";
  }
}

const MIN_ROUNDS = 1;
const MAX_ROUNDS = 3;
const MIN_AGENTS = 2;
const MAX_AGENTS = 5;

export function parseRounds(raw: string | number): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value)) {
    throw new SwarmCommandError(`rounds must be an integer (got "${raw}")`);
  }
  if (value < MIN_ROUNDS || value > MAX_ROUNDS) {
    throw new SwarmCommandError(
      `rounds must be between ${MIN_ROUNDS} and ${MAX_ROUNDS} (got ${value})`,
    );
  }
  return value;
}

export function parseAgentsCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

const RESOLVE_SYNONYMS: Record<string, ResolveMode> = {
  off: "off",
  none: "off",
  no: "off",
  false: "off",
  "0": "off",
  on: "orchestrator",
  yes: "orchestrator",
  true: "orchestrator",
  "1": "orchestrator",
  orchestrator: "orchestrator",
  agent: "agents",
  agents: "agents",
};

export function parseResolveMode(raw: string): ResolveMode {
  const normalized = raw.trim().toLowerCase();
  const mapped = RESOLVE_SYNONYMS[normalized];
  if (mapped) {
    return mapped;
  }
  const direct = ResolveModeSchema.safeParse(normalized);
  if (direct.success) {
    return direct.data;
  }
  throw new SwarmCommandError(`invalid --resolve mode: "${raw}"`);
}

export function parseBackendId(raw: string): BackendId {
  const normalized = raw.trim().toLowerCase();
  const parsed = BackendIdSchema.safeParse(normalized);
  if (parsed.success) {
    return parsed.data;
  }
  throw new SwarmCommandError(`invalid --backend: "${raw}"`);
}

export function parseTimeoutMs(raw: string | number): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new SwarmCommandError(
      `--timeout-ms must be a positive integer (got "${raw}")`,
    );
  }
  return value;
}

export function dedupeKeepOrder<T>(items: Iterable<T>): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

export interface BuildConfigInput {
  rounds: string | number;
  topic: string[] | string;
  agents?: string;
  backend?: string;
  resolve?: string;
  goal?: string;
  decision?: string;
  docs?: string[];
  preset?: string;
  timeoutMs?: string | number;
  selectionSource?: AgentSelectionSource;
  commandText?: string;
}

export function buildConfig(input: BuildConfigInput): SwarmRunConfig {
  const rounds = parseRounds(input.rounds);
  const backend =
    input.backend === undefined ? "claude" : parseBackendId(input.backend);

  const topic = (
    Array.isArray(input.topic) ? input.topic.join(" ") : input.topic
  ).trim();
  if (!topic) {
    throw new SwarmCommandError("topic is required");
  }

  let agents: string[] = [];
  let selectionSource: AgentSelectionSource =
    input.selectionSource ?? "default-preset";
  if (input.agents !== undefined) {
    agents = dedupeKeepOrder(parseAgentsCsv(input.agents));
    if (input.selectionSource === undefined) {
      selectionSource = "explicit-agents";
    }
  } else if (
    input.preset !== undefined &&
    input.selectionSource === undefined
  ) {
    selectionSource = "preset";
  }

  if (agents.length < MIN_AGENTS || agents.length > MAX_AGENTS) {
    throw new SwarmCommandError(
      `--agents must resolve to between ${MIN_AGENTS} and ${MAX_AGENTS} entries (got ${agents.length})`,
    );
  }

  const resolveMode: ResolveMode =
    input.resolve === undefined ? "off" : parseResolveMode(input.resolve);
  const timeoutMs =
    input.timeoutMs === undefined
      ? DEFAULT_DISPATCH_TIMEOUT_MS
      : parseTimeoutMs(input.timeoutMs);

  const docs = dedupeKeepOrder(
    (input.docs ?? []).map((d) => d.trim()).filter(Boolean),
  );

  const goal = input.goal?.trim() || null;
  const decision = input.decision?.trim() || null;
  const preset = input.preset?.trim() || null;

  return {
    topic,
    rounds,
    backend,
    preset,
    agents,
    selectionSource,
    resolveMode,
    timeoutMs,
    goal,
    decision,
    docs,
    commandText: input.commandText?.trim() ?? "",
  };
}
