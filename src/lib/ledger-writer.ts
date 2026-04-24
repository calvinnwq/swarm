import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MessageEnvelopeSchema,
  type MessageEnvelope,
} from "../schemas/message.js";
import { RunEventSchema, type RunEvent } from "../schemas/run-event.js";
import type { RunStatus } from "../schemas/run-manifest.js";
import type { OutputTarget } from "./output-router.js";
import type { RoundResult } from "./round-runner.js";
import type { SynthesisResult } from "./synthesis.js";

const MESSAGES_FILE = "messages.jsonl";
const EVENTS_FILE = "events.jsonl";

/**
 * Append-only ledger for messages and orchestration events within a single run.
 *
 * Files are written as JSONL (one JSON object per line) inside the run directory,
 * giving durable ordering guarantees that replay, inspection, and debugging can rely on.
 *
 * Implements OutputTarget so it can be registered with OutputRouter; the router
 * calls init() which creates the ledger files. Append methods are called directly
 * by the orchestration layer.
 */
export class LedgerWriter implements OutputTarget {
  readonly messagesPath: string;
  readonly eventsPath: string;

  constructor(readonly runDir: string) {
    this.messagesPath = join(runDir, MESSAGES_FILE);
    this.eventsPath = join(runDir, EVENTS_FILE);
  }

  /**
   * Create the run directory and initialize empty ledger files.
   * Safe to call even if the directory already exists.
   */
  init(): void {
    mkdirSync(this.runDir, { recursive: true });
    appendFileSync(this.messagesPath, "");
    appendFileSync(this.eventsPath, "");
  }

  /**
   * Validate and append a message envelope to the message ledger.
   * Throws a ZodError if the message fails schema validation.
   */
  appendMessage(msg: MessageEnvelope): void {
    MessageEnvelopeSchema.parse(msg);
    appendFileSync(this.messagesPath, JSON.stringify(msg) + "\n");
  }

  /**
   * Validate and append a run event to the event ledger.
   * Throws a ZodError if the event fails schema validation.
   */
  appendEvent(event: RunEvent): void {
    RunEventSchema.parse(event);
    appendFileSync(this.eventsPath, JSON.stringify(event) + "\n");
  }

  /**
   * Read and parse all message envelopes from the ledger in insertion order.
   * Returns an empty array if the ledger file does not exist or is empty.
   */
  readMessages(): MessageEnvelope[] {
    return readJsonl(this.messagesPath, MessageEnvelopeSchema);
  }

  /**
   * Read and parse all run events from the ledger in insertion order.
   * Returns an empty array if the ledger file does not exist or is empty.
   */
  readEvents(): RunEvent[] {
    return readJsonl(this.eventsPath, RunEventSchema);
  }

  /**
   * Return the highest round number for which a "round:completed" event has
   * been written. Returns 0 if no round has been completed yet.
   */
  getLastCompletedRound(): number {
    const events = this.readEvents();
    let last = 0;
    for (const event of events) {
      if (event.kind === "round:completed" && (event.roundNumber ?? 0) > last) {
        last = event.roundNumber ?? 0;
      }
    }
    return last;
  }

  // OutputTarget lifecycle hooks: no-ops because the orchestration layer
  // drives event emission by calling appendEvent directly.
  writeRound(roundResult: RoundResult, brief: string): void {
    void roundResult;
    void brief;
  }

  writeSynthesis(synthesis: SynthesisResult): void {
    void synthesis;
  }

  finalize(
    finishedAt: string,
    status: Extract<RunStatus, "done" | "failed">,
  ): void {
    void finishedAt;
    void status;
  }
}

type ZodLike<T> = { parse: (v: unknown) => T };

function readJsonl<T>(filePath: string, schema: ZodLike<T>): T[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => schema.parse(JSON.parse(line)));
}
