import { EventEmitter } from "node:events";
import type {
  AgentDefinition,
  AgentOutput,
  RoundPacket,
} from "../schemas/index.js";
import { AgentOutputSchema } from "../schemas/index.js";
import type { AgentResponse, BackendAdapter } from "../backends/index.js";
import { extractJson } from "../backends/claude-cli.js";
import type { SwarmRunConfig } from "./config.js";
import { buildSeedBrief, buildRoundBrief } from "./brief-generator.js";

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface AgentResult {
  agent: string;
  ok: boolean;
  output: AgentOutput | null;
  raw: AgentResponse | null;
  error: string | null;
}

export interface RoundResult {
  round: number;
  agentResults: AgentResult[];
  packet: RoundPacket;
}

export interface RunResult {
  rounds: RoundResult[];
  ok: boolean;
  error: string | null;
}

export interface RoundRunnerEvents {
  "round:start": { round: number; agents: string[] };
  "agent:start": { round: number; agent: string };
  "agent:ok": {
    round: number;
    agent: string;
    output: AgentOutput;
    durationMs: number;
  };
  "agent:fail": {
    round: number;
    agent: string;
    error: string;
    durationMs: number;
  };
  "round:done": {
    round: number;
    packet: RoundPacket;
    agentResults: AgentResult[];
  };
  "run:done": { rounds: RoundResult[]; ok: boolean };
}

export interface RoundRunnerOpts {
  config: SwarmRunConfig;
  agents: AgentDefinition[];
  backend: BackendAdapter;
  concurrency?: number;
  timeoutMs?: number;
}

function buildRoundPacket(
  round: number,
  agentResults: AgentResult[],
): RoundPacket {
  const successful = agentResults.filter((r) => r.ok && r.output !== null);

  const summaries = successful.map((r) => {
    const o = r.output!;
    return {
      agent: o.agent,
      stance: o.stance,
      recommendation: o.recommendation,
      objections: o.objections,
      risks: o.risks,
      confidence: o.confidence,
      openQuestions: o.openQuestions,
    };
  });

  // Shared risks: mentioned by 2+ agents
  const riskCounts = new Map<string, number>();
  for (const r of successful) {
    for (const risk of r.output!.risks) {
      riskCounts.set(risk, (riskCounts.get(risk) ?? 0) + 1);
    }
  }
  const sharedRisks = [...riskCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([risk]) => risk);

  const keyObjections = successful.flatMap((r) => r.output!.objections);
  const openQuestions = successful.flatMap((r) => r.output!.openQuestions);

  return {
    round,
    agents: agentResults.map((r) => r.agent),
    summaries,
    keyObjections,
    sharedRisks,
    openQuestions,
    questionResolutions: [],
    questionResolutionLimit: 0,
    deferredQuestions: [],
  };
}

async function dispatchAgent(
  backend: BackendAdapter,
  brief: string,
  agent: AgentDefinition,
  timeoutMs: number,
): Promise<AgentResult> {
  let response: AgentResponse;
  try {
    response = await backend.dispatch(brief, agent, { timeoutMs });
  } catch (err) {
    return {
      agent: agent.name,
      ok: false,
      output: null,
      raw: null,
      error: `Dispatch error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    return {
      agent: agent.name,
      ok: false,
      output: null,
      raw: response,
      error: response.timedOut
        ? `Agent timed out after ${response.durationMs}ms`
        : `Agent exited with code ${response.exitCode}: ${response.stderr}`,
    };
  }

  const json = extractJson(response.stdout);
  if (json === undefined) {
    return {
      agent: agent.name,
      ok: false,
      output: null,
      raw: response,
      error: `Failed to extract JSON from agent output`,
    };
  }

  const parsed = AgentOutputSchema.safeParse(json);
  if (!parsed.success) {
    return {
      agent: agent.name,
      ok: false,
      output: null,
      raw: response,
      error: `Schema validation failed: ${parsed.error.message}`,
    };
  }

  return {
    agent: agent.name,
    ok: true,
    output: parsed.data,
    raw: response,
    error: null,
  };
}

export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Create a round runner with an event emitter for external subscriptions.
 * Returns both the emitter (for UI/writer subscription) and a start function.
 */
export function createRoundRunner(opts: RoundRunnerOpts): {
  emitter: EventEmitter;
  run: () => Promise<RunResult>;
} {
  const {
    config,
    agents,
    backend,
    concurrency = Number(process.env["SWARM_CONCURRENCY"]) ||
      DEFAULT_CONCURRENCY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts;

  const emitter = new EventEmitter();

  async function run(): Promise<RunResult> {
    const roundResults: RoundResult[] = [];
    const seedBrief = buildSeedBrief(config);
    let priorPacket: RoundPacket | null = null;

    for (let round = 1; round <= config.rounds; round++) {
      const agentNames = agents.map((a) => a.name);
      emitter.emit("round:start", { round, agents: agentNames });

      const brief = buildRoundBrief({ config, round, seedBrief, priorPacket });

      const tasks = agents.map((agent) => () => {
        emitter.emit("agent:start", { round, agent: agent.name });
        return dispatchAgent(backend, brief, agent, timeoutMs);
      });

      const agentResults = await runWithConcurrency(tasks, concurrency);

      for (const result of agentResults) {
        if (result.ok) {
          emitter.emit("agent:ok", {
            round,
            agent: result.agent,
            output: result.output,
            durationMs: result.raw?.durationMs ?? 0,
          });
        } else {
          emitter.emit("agent:fail", {
            round,
            agent: result.agent,
            error: result.error,
            durationMs: result.raw?.durationMs ?? 0,
          });
        }
      }

      const successCount = agentResults.filter((r) => r.ok).length;
      if (successCount < 2) {
        const packet = buildRoundPacket(round, agentResults);
        const roundResult: RoundResult = { round, agentResults, packet };
        roundResults.push(roundResult);
        emitter.emit("round:done", { round, packet, agentResults });
        emitter.emit("run:done", { rounds: roundResults, ok: false });
        return {
          rounds: roundResults,
          ok: false,
          error: `Round ${round} failed: only ${successCount} agent(s) succeeded (minimum 2 required)`,
        };
      }

      const packet = buildRoundPacket(round, agentResults);
      priorPacket = packet;
      const roundResult: RoundResult = { round, agentResults, packet };
      roundResults.push(roundResult);
      emitter.emit("round:done", { round, packet, agentResults });
    }

    emitter.emit("run:done", { rounds: roundResults, ok: true });
    return { rounds: roundResults, ok: true, error: null };
  }

  return { emitter, run };
}
