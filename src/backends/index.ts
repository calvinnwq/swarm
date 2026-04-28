import type { AgentDefinition } from "../schemas/index.js";

export interface AgentResponse {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export type BackendOutputSchema = "agent" | "orchestrator";

export interface BackendDispatchOptions {
  timeoutMs: number;
  outputSchema?: BackendOutputSchema;
}

export interface BackendAdapter {
  readonly wrapperName?: string;
  extractOutputJson?(raw: string): unknown;
  formatFailure?(response: AgentResponse): string;
  dispatch(
    prompt: string,
    agent: AgentDefinition,
    opts: BackendDispatchOptions,
  ): Promise<AgentResponse>;
}

export { createBackendAdapter } from "./factory.js";
export {
  createHarnessAdapter,
  buildHarnessAdapterRegistry,
  createAgentAdapterResolver,
  createAgentRuntimeResolver,
  HarnessAdapterRegistry,
} from "./harness-adapter.js";
