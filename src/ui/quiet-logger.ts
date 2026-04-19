import type { EventEmitter } from "node:events";
import type { RoundRunnerEvents } from "../lib/round-runner.js";

export interface QuietLoggerOpts {
  write?: (line: string) => void;
}

/**
 * Attach a plain-text, one-line-per-event logger to a round runner emitter.
 * Intended for CI / --quiet mode: no ANSI, no cursor movement, just structured lines.
 */
export function attachQuietLogger(
  emitter: EventEmitter,
  opts: QuietLoggerOpts = {},
): void {
  const write = opts.write ?? ((line: string) => process.stderr.write(line));

  emitter.on(
    "round:start",
    (e: RoundRunnerEvents["round:start"]) => {
      write(`[round ${e.round}] start agents=${e.agents.join(",")}\n`);
    },
  );

  emitter.on(
    "agent:start",
    (e: RoundRunnerEvents["agent:start"]) => {
      write(`[round ${e.round}] ${e.agent} dispatching\n`);
    },
  );

  emitter.on(
    "agent:ok",
    (e: RoundRunnerEvents["agent:ok"]) => {
      const sec = (e.durationMs / 1000).toFixed(1);
      write(
        `[round ${e.round}] ${e.agent} ok stance=${e.output.stance} confidence=${e.output.confidence} ${sec}s\n`,
      );
    },
  );

  emitter.on(
    "agent:fail",
    (e: RoundRunnerEvents["agent:fail"]) => {
      const sec = (e.durationMs / 1000).toFixed(1);
      write(`[round ${e.round}] ${e.agent} FAILED ${e.error} ${sec}s\n`);
    },
  );

  emitter.on(
    "round:done",
    (e: RoundRunnerEvents["round:done"]) => {
      const ok = e.agentResults.filter((r) => r.ok).length;
      const fail = e.agentResults.length - ok;
      write(`[round ${e.round}] done ok=${ok} fail=${fail}\n`);
    },
  );

  emitter.on(
    "run:done",
    (e: RoundRunnerEvents["run:done"]) => {
      write(
        `[run] ${e.ok ? "complete" : "failed"} rounds=${e.rounds.length}\n`,
      );
    },
  );
}
