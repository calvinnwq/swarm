import type { LedgerWriter } from "./ledger-writer.js";
import { MessageEnvelopeSchema, type MessageEnvelope } from "../schemas/message.js";

/**
 * Runtime-owned inbox for per-agent staged/committed message delivery.
 *
 * Wraps LedgerWriter so every stage and commit operation is durably persisted
 * before the in-memory inbox state is updated. The two-phase protocol means
 * the JSONL ledger records the full delivery audit trail:
 *   staged  → message is queued but not yet visible to the recipient
 *   committed → message is confirmed delivered for the current round
 */
export class InboxManager {
  private readonly staged = new Map<string, MessageEnvelope[]>();
  private readonly committed = new Map<string, MessageEnvelope[]>();

  constructor(private readonly ledger: LedgerWriter) {}

  /**
   * Enqueue a message for each of its recipients.
   * The envelope must already have deliveryStatus "staged".
   * Writes the record to the durable ledger before updating in-memory state.
   */
  stage(message: MessageEnvelope): void {
    if (message.deliveryStatus !== "staged") {
      throw new Error(
        `Cannot stage message "${message.messageId}": deliveryStatus must be "staged", got "${message.deliveryStatus}"`,
      );
    }
    this.ledger.appendMessage(message);
    for (const recipient of message.recipients) {
      let bucket = this.staged.get(recipient);
      if (bucket === undefined) {
        bucket = [];
        this.staged.set(recipient, bucket);
      }
      bucket.push(message);
    }
  }

  /**
   * Commit all staged messages for a recipient.
   * Each message is re-written to the ledger with deliveryStatus "committed",
   * then moved from the staged queue to the committed list.
   * Returns the committed envelopes (empty array if none were pending).
   */
  commit(recipient: string): MessageEnvelope[] {
    const pending = this.staged.get(recipient);
    if (!pending || pending.length === 0) return [];

    const result: MessageEnvelope[] = [];
    for (const msg of pending) {
      const committedMsg = MessageEnvelopeSchema.parse({
        ...msg,
        deliveryStatus: "committed",
      });
      this.ledger.appendMessage(committedMsg);
      let bucket = this.committed.get(recipient);
      if (bucket === undefined) {
        bucket = [];
        this.committed.set(recipient, bucket);
      }
      bucket.push(committedMsg);
      result.push(committedMsg);
    }
    this.staged.delete(recipient);
    return result;
  }

  /**
   * Returns pending (staged but not yet committed) messages for a recipient.
   */
  getStaged(recipient: string): readonly MessageEnvelope[] {
    return this.staged.get(recipient) ?? [];
  }

  /**
   * Returns committed messages for a recipient.
   */
  getCommitted(recipient: string): readonly MessageEnvelope[] {
    return this.committed.get(recipient) ?? [];
  }

  /**
   * Returns names of all recipients that have at least one staged message.
   */
  stagedRecipients(): string[] {
    const result: string[] = [];
    for (const [key, msgs] of this.staged) {
      if (msgs.length > 0) result.push(key);
    }
    return result;
  }
}
