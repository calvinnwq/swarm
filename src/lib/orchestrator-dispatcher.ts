import type { AgentResponse, BackendAdapter } from "../backends/index.js";
import type {
  AgentDefinition,
  OrchestratorOutput,
  RoundPacket,
} from "../schemas/index.js";
import { buildOrchestratorResolutionPrompt } from "./orchestrator-prompt.js";
import {
  buildOrchestratorRepairPrompt,
  validateOrchestratorOutput,
} from "./orchestrator-output.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_FORMAT_REPAIR_ATTEMPTS = 1;

export interface DispatchOrchestratorPassArgs {
  backend: BackendAdapter;
  agent: AgentDefinition;
  packet: RoundPacket;
  goal: string | null;
  decision: string | null;
  /** The round this resolution pass produces a directive for (typically packet.round + 1). */
  nextRound: number;
  timeoutMs?: number;
}

export type DispatchOrchestratorPassResult =
  | { ok: true; output: OrchestratorOutput; raw: AgentResponse }
  | { ok: false; error: string; raw: AgentResponse | null };

function formatBackendFailure(
  backend: BackendAdapter,
  response: AgentResponse,
): string {
  if (backend.formatFailure) {
    return backend.formatFailure(response);
  }
  if (response.timedOut) {
    return `Orchestrator timed out after ${response.durationMs}ms`;
  }
  return `Orchestrator exited with code ${response.exitCode}: ${response.stderr}`;
}

export async function dispatchOrchestratorPass(
  args: DispatchOrchestratorPassArgs,
): Promise<DispatchOrchestratorPassResult> {
  const {
    backend,
    agent,
    packet,
    goal,
    decision,
    nextRound,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = args;

  const prompt = buildOrchestratorResolutionPrompt({
    packet,
    goal,
    decision,
    nextRound,
  });

  type DispatchAttempt =
    | { kind: "response"; response: AgentResponse }
    | { kind: "error"; error: string };

  const dispatch = async (input: string): Promise<DispatchAttempt> => {
    try {
      const response = await backend.dispatch(input, agent, { timeoutMs });
      return { kind: "response", response };
    } catch (err) {
      return {
        kind: "error",
        error: `Dispatch error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };

  const initial = await dispatch(prompt);
  if (initial.kind === "error") {
    return { ok: false, error: initial.error, raw: null };
  }
  let response = initial.response;
  if (!response.ok) {
    return {
      ok: false,
      error: formatBackendFailure(backend, response),
      raw: response,
    };
  }

  let validation = validateOrchestratorOutput(response.stdout);
  for (
    let attempt = 0;
    !validation.ok && attempt < MAX_FORMAT_REPAIR_ATTEMPTS;
    attempt++
  ) {
    const repairPrompt = buildOrchestratorRepairPrompt(
      prompt,
      validation.error,
      response.stdout,
    );
    const repaired = await dispatch(repairPrompt);
    if (repaired.kind === "error") {
      return {
        ok: false,
        error: `${validation.error}; repair dispatch failed: ${repaired.error}`,
        raw: response,
      };
    }
    if (!repaired.response.ok) {
      return {
        ok: false,
        error: formatBackendFailure(backend, repaired.response),
        raw: repaired.response,
      };
    }
    response = repaired.response;
    validation = validateOrchestratorOutput(response.stdout);
  }

  if (!validation.ok) {
    return {
      ok: false,
      error: `${validation.error} after ${MAX_FORMAT_REPAIR_ATTEMPTS + 1} attempt(s)`,
      raw: response,
    };
  }

  return { ok: true, output: validation.output, raw: response };
}
