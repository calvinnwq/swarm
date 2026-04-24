import { EventEmitter } from "node:events";
import type {
  AgentDefinition,
  AgentOutput,
  RoundPacket,
} from "../schemas/index.js";
import { AgentOutputSchema } from "../schemas/index.js";
import type { AgentResponse, BackendAdapter } from "../backends/index.js";
import { extractAgentOutputJson } from "../backends/json-output.js";
import type { SwarmRunConfig } from "./config.js";
import { buildSeedBrief, buildRoundBrief } from "./brief-generator.js";
import {
  selectAgentsForRound,
  type SchedulerPolicy,
  type SchedulerDecision,
} from "./scheduler.js";

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_FORMAT_REPAIR_ATTEMPTS = 1;

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
  "round:start": {
    round: number;
    agents: string[];
    schedulerDecision: SchedulerDecision;
  };
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
  schedulerPolicy?: SchedulerPolicy;
  /** First round to execute; rounds before this are treated as already complete (resume path). */
  startRound?: number;
  /** Prior-round packet to seed the scheduler and brief-builder (resume path). */
  initialPriorPacket?: RoundPacket | null;
  /** Orchestrator directive carried over from the last completed round (resume path). */
  initialOrchestratorDirective?: string;
  betweenRounds?: (args: {
    round: number;
    packet: RoundPacket;
  }) => Promise<{ directive: string } | undefined>;
}

function validateAgentOutput(
  backend: BackendAdapter,
  stdout: string,
): { ok: true; output: AgentOutput } | { ok: false; error: string } {
  const json =
    backend.extractOutputJson?.(stdout) ?? extractAgentOutputJson(stdout);
  if (json === undefined) {
    return {
      ok: false,
      error: "Failed to extract JSON from agent output",
    };
  }

  const parsed = AgentOutputSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Schema validation failed: ${parsed.error.message}`,
    };
  }

  return { ok: true, output: parsed.data };
}

function formatBackendFailure(
  backend: BackendAdapter,
  response: AgentResponse,
): string {
  if (backend.formatFailure) {
    return backend.formatFailure(response);
  }

  if (response.timedOut) {
    return `Agent timed out after ${response.durationMs}ms`;
  }

  return `Agent exited with code ${response.exitCode}: ${response.stderr}`;
}

function buildRepairPrompt(
  brief: string,
  agent: AgentDefinition,
  validationError: string,
  invalidStdout: string,
): string {
  return `${brief}

Your previous response for agent "${agent.name}" could not be accepted.
Validation error: ${validationError}

Return only a single valid JSON object with exactly these required fields:
- agent
- round
- stance
- recommendation
- reasoning
- objections
- risks
- changesFromPriorRound
- confidence
- openQuestions

Do not include markdown fences, prose, or any text before/after the JSON.

Previous invalid response:
\`\`\`
${invalidStdout}
\`\`\``;
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
  async function dispatch(
    prompt: string,
  ): Promise<AgentResponse | AgentResult> {
    try {
      return await backend.dispatch(prompt, agent, { timeoutMs });
    } catch (err) {
      return {
        agent: agent.name,
        ok: false,
        output: null,
        raw: null,
        error: `Dispatch error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const initial = await dispatch(brief);
  if ("agent" in initial) {
    return initial;
  }

  let response = initial;

  if (!response.ok) {
    return {
      agent: agent.name,
      ok: false,
      output: null,
      raw: response,
      error: formatBackendFailure(backend, response),
    };
  }

  let validation = validateAgentOutput(backend, response.stdout);
  for (
    let attempt = 0;
    !validation.ok && attempt < MAX_FORMAT_REPAIR_ATTEMPTS;
    attempt++
  ) {
    const repaired = await dispatch(
      buildRepairPrompt(brief, agent, validation.error, response.stdout),
    );
    if ("agent" in repaired) {
      return {
        agent: agent.name,
        ok: false,
        output: null,
        raw: response,
        error: `${validation.error}; repair dispatch failed: ${repaired.error}`,
      };
    }
    if (!repaired.ok) {
      return {
        agent: agent.name,
        ok: false,
        output: null,
        raw: repaired,
        error: formatBackendFailure(backend, repaired),
      };
    }
    response = repaired;
    validation = validateAgentOutput(backend, response.stdout);
  }

  if (!validation.ok) {
    return {
      agent: agent.name,
      ok: false,
      output: null,
      raw: response,
      error: `${validation.error} after ${MAX_FORMAT_REPAIR_ATTEMPTS + 1} attempt(s)`,
    };
  }

  return {
    agent: agent.name,
    ok: true,
    output: validation.output,
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
    schedulerPolicy = "all",
    startRound = 1,
  } = opts;

  const emitter = new EventEmitter();

  async function run(): Promise<RunResult> {
    const roundResults: RoundResult[] = [];
    const seedBrief = buildSeedBrief(config);
    let priorPacket: RoundPacket | null = opts.initialPriorPacket ?? null;
    let orchestratorDirective: string | undefined =
      opts.initialOrchestratorDirective;

    for (let round = startRound; round <= config.rounds; round++) {
      const schedulerDecision = selectAgentsForRound(
        agents,
        round,
        priorPacket,
        schedulerPolicy,
      );
      const selectedAgentNames = new Set(schedulerDecision.selected);
      const roundAgents = agents.filter((a) => selectedAgentNames.has(a.name));
      emitter.emit("round:start", {
        round,
        agents: schedulerDecision.selected,
        schedulerDecision,
      });

      const brief = buildRoundBrief({
        config,
        round,
        seedBrief,
        priorPacket,
        orchestratorDirective,
      });

      const tasks = roundAgents.map((agent) => () => {
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

      if (round < config.rounds) {
        const passResult = await opts.betweenRounds?.({ round, packet });
        orchestratorDirective = passResult?.directive;
      }
    }

    emitter.emit("run:done", { rounds: roundResults, ok: true });
    return { rounds: roundResults, ok: true, error: null };
  }

  return { emitter, run };
}
