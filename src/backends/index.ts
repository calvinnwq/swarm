import type { AgentDefinition } from "../schemas/index.js";

export interface AgentResponse {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface BackendAdapter {
  dispatch(
    prompt: string,
    agent: AgentDefinition,
    opts: { timeoutMs: number },
  ): Promise<AgentResponse>;
}

export { createBackendAdapter } from "./factory.js";
