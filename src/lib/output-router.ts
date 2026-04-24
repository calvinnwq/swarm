import type { RoundResult } from "./round-runner.js";
import type { SynthesisResult } from "./synthesis.js";
import type { RunStatus } from "../schemas/index.js";

/**
 * Delivery hook for a single output destination.
 * Implementors receive the same lifecycle events as the disk artifact writer.
 * All methods may return void or a Promise.
 */
export interface OutputTarget {
  init(): void | Promise<void>;
  writeRound(roundResult: RoundResult, brief: string): void | Promise<void>;
  writeSynthesis(synthesis: SynthesisResult): void | Promise<void>;
  finalize(
    finishedAt: string,
    status: Extract<RunStatus, "done" | "failed">,
  ): void | Promise<void>;
}

/**
 * Fans a run's lifecycle events out to one or more OutputTargets in order.
 * Keeps transport logic out of the core round runner.
 */
export class OutputRouter {
  constructor(private readonly targets: OutputTarget[]) {}

  async init(): Promise<void> {
    for (const t of this.targets) await t.init();
  }

  async writeRound(roundResult: RoundResult, brief: string): Promise<void> {
    for (const t of this.targets) await t.writeRound(roundResult, brief);
  }

  async writeSynthesis(synthesis: SynthesisResult): Promise<void> {
    for (const t of this.targets) await t.writeSynthesis(synthesis);
  }

  async finalize(
    finishedAt: string,
    status: Extract<RunStatus, "done" | "failed">,
  ): Promise<void> {
    for (const t of this.targets) await t.finalize(finishedAt, status);
  }
}
