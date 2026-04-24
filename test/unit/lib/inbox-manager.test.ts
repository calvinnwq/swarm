import { describe, expect, it, beforeEach, vi } from "vitest";
import { InboxManager } from "../../../src/lib/inbox-manager.js";
import type { LedgerWriter } from "../../../src/lib/ledger-writer.js";
import type { MessageEnvelope } from "../../../src/schemas/message.js";

function makeLedger(): LedgerWriter {
  return {
    appendMessage: vi.fn(),
    appendEvent: vi.fn(),
    readMessages: vi.fn(() => []),
    readEvents: vi.fn(() => []),
    init: vi.fn(),
    writeRound: vi.fn(),
    writeSynthesis: vi.fn(),
    finalize: vi.fn(),
    runDir: "/fake/run",
    messagesPath: "/fake/run/messages.jsonl",
    eventsPath: "/fake/run/events.jsonl",
  } as unknown as LedgerWriter;
}

function makeEnvelope(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return {
    messageId: "msg-001",
    senderId: "orchestrator",
    recipients: ["agent-alpha"],
    kind: "task",
    payload: { brief: "analyze this", round: 1 },
    deliveryStatus: "staged",
    createdAt: "2026-04-24T03:00:00.000Z",
    roundNumber: 1,
    ...overrides,
  };
}

let ledger: LedgerWriter;
let inbox: InboxManager;

beforeEach(() => {
  ledger = makeLedger();
  inbox = new InboxManager(ledger);
});

describe("InboxManager", () => {
  describe("stage", () => {
    it("writes the staged message to the ledger", () => {
      const msg = makeEnvelope();
      inbox.stage(msg);
      expect(ledger.appendMessage).toHaveBeenCalledTimes(1);
      expect(ledger.appendMessage).toHaveBeenCalledWith(msg);
    });

    it("adds the message to the recipient staged queue", () => {
      const msg = makeEnvelope();
      inbox.stage(msg);
      expect(inbox.getStaged("agent-alpha")).toHaveLength(1);
      expect(inbox.getStaged("agent-alpha")[0]).toEqual(msg);
    });

    it("fans out to all recipients in the envelope", () => {
      const msg = makeEnvelope({ recipients: ["agent-alpha", "agent-beta"] });
      inbox.stage(msg);
      expect(inbox.getStaged("agent-alpha")).toHaveLength(1);
      expect(inbox.getStaged("agent-beta")).toHaveLength(1);
    });

    it("accumulates multiple staged messages per recipient", () => {
      inbox.stage(makeEnvelope({ messageId: "msg-001" }));
      inbox.stage(makeEnvelope({ messageId: "msg-002" }));
      expect(inbox.getStaged("agent-alpha")).toHaveLength(2);
      expect(ledger.appendMessage).toHaveBeenCalledTimes(2);
    });

    it("supports broadcast recipient", () => {
      const msg = makeEnvelope({ recipients: ["broadcast"] });
      inbox.stage(msg);
      expect(inbox.getStaged("broadcast")).toHaveLength(1);
    });

    it("supports orchestrator recipient", () => {
      const msg = makeEnvelope({ recipients: ["orchestrator"] });
      inbox.stage(msg);
      expect(inbox.getStaged("orchestrator")).toHaveLength(1);
    });

    it("throws when deliveryStatus is not staged", () => {
      const msg = makeEnvelope({ deliveryStatus: "committed" });
      expect(() => inbox.stage(msg)).toThrow(/deliveryStatus must be "staged"/);
    });

    it("does not write to the ledger when it throws", () => {
      const msg = makeEnvelope({ deliveryStatus: "committed" });
      expect(() => inbox.stage(msg)).toThrow();
      expect(ledger.appendMessage).not.toHaveBeenCalled();
    });
  });

  describe("commit", () => {
    it("returns empty array when no messages are staged for the recipient", () => {
      expect(inbox.commit("agent-alpha")).toEqual([]);
    });

    it("does not write to the ledger when nothing is staged", () => {
      inbox.commit("agent-alpha");
      expect(ledger.appendMessage).not.toHaveBeenCalled();
    });

    it("writes committed envelopes to the ledger", () => {
      inbox.stage(makeEnvelope());
      vi.clearAllMocks();

      inbox.commit("agent-alpha");

      expect(ledger.appendMessage).toHaveBeenCalledTimes(1);
      const written = vi.mocked(ledger.appendMessage).mock.calls[0][0];
      expect(written.deliveryStatus).toBe("committed");
    });

    it("returns committed envelopes with deliveryStatus committed", () => {
      inbox.stage(makeEnvelope());
      const result = inbox.commit("agent-alpha");
      expect(result).toHaveLength(1);
      expect(result[0].deliveryStatus).toBe("committed");
    });

    it("preserves all other envelope fields when committing", () => {
      const msg = makeEnvelope({ messageId: "msg-xyz", roundNumber: 2 });
      inbox.stage(msg);
      const [committed] = inbox.commit("agent-alpha");
      expect(committed.messageId).toBe("msg-xyz");
      expect(committed.roundNumber).toBe(2);
      expect(committed.senderId).toBe("orchestrator");
    });

    it("clears the staged queue after committing", () => {
      inbox.stage(makeEnvelope());
      inbox.commit("agent-alpha");
      expect(inbox.getStaged("agent-alpha")).toHaveLength(0);
    });

    it("moves messages to committed list after committing", () => {
      inbox.stage(makeEnvelope());
      inbox.commit("agent-alpha");
      expect(inbox.getCommitted("agent-alpha")).toHaveLength(1);
      expect(inbox.getCommitted("agent-alpha")[0].deliveryStatus).toBe("committed");
    });

    it("commits multiple staged messages in order", () => {
      inbox.stage(makeEnvelope({ messageId: "msg-001" }));
      inbox.stage(makeEnvelope({ messageId: "msg-002" }));
      const result = inbox.commit("agent-alpha");
      expect(result).toHaveLength(2);
      expect(result[0].messageId).toBe("msg-001");
      expect(result[1].messageId).toBe("msg-002");
    });

    it("only commits messages for the specified recipient", () => {
      inbox.stage(makeEnvelope({ messageId: "msg-a", recipients: ["agent-alpha"] }));
      inbox.stage(makeEnvelope({ messageId: "msg-b", recipients: ["agent-beta"] }));
      inbox.commit("agent-alpha");
      expect(inbox.getStaged("agent-beta")).toHaveLength(1);
      expect(inbox.getCommitted("agent-beta")).toHaveLength(0);
    });

    it("accumulates committed messages across multiple rounds", () => {
      inbox.stage(makeEnvelope({ messageId: "msg-001", roundNumber: 1 }));
      inbox.commit("agent-alpha");
      inbox.stage(makeEnvelope({ messageId: "msg-002", roundNumber: 2 }));
      inbox.commit("agent-alpha");
      expect(inbox.getCommitted("agent-alpha")).toHaveLength(2);
    });
  });

  describe("getStaged", () => {
    it("returns empty array for unknown recipient", () => {
      expect(inbox.getStaged("unknown-agent")).toEqual([]);
    });

    it("returns staged messages without removing them", () => {
      inbox.stage(makeEnvelope());
      inbox.getStaged("agent-alpha");
      expect(inbox.getStaged("agent-alpha")).toHaveLength(1);
    });

    it("returns readonly snapshot", () => {
      inbox.stage(makeEnvelope());
      const result = inbox.getStaged("agent-alpha");
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getCommitted", () => {
    it("returns empty array for unknown recipient", () => {
      expect(inbox.getCommitted("unknown-agent")).toEqual([]);
    });

    it("returns empty array before any commits", () => {
      inbox.stage(makeEnvelope());
      expect(inbox.getCommitted("agent-alpha")).toHaveLength(0);
    });
  });

  describe("stagedRecipients", () => {
    it("returns empty array when no messages are staged", () => {
      expect(inbox.stagedRecipients()).toEqual([]);
    });

    it("returns the recipient when a message is staged", () => {
      inbox.stage(makeEnvelope());
      expect(inbox.stagedRecipients()).toContain("agent-alpha");
    });

    it("returns all recipients with pending staged messages", () => {
      inbox.stage(makeEnvelope({ recipients: ["agent-alpha"] }));
      inbox.stage(makeEnvelope({ recipients: ["agent-beta"] }));
      const recipients = inbox.stagedRecipients();
      expect(recipients).toContain("agent-alpha");
      expect(recipients).toContain("agent-beta");
    });

    it("excludes recipients after their messages are committed", () => {
      inbox.stage(makeEnvelope());
      inbox.commit("agent-alpha");
      expect(inbox.stagedRecipients()).not.toContain("agent-alpha");
    });

    it("retains other recipients after one commits", () => {
      inbox.stage(makeEnvelope({ recipients: ["agent-alpha"] }));
      inbox.stage(makeEnvelope({ recipients: ["agent-beta"] }));
      inbox.commit("agent-alpha");
      expect(inbox.stagedRecipients()).toContain("agent-beta");
      expect(inbox.stagedRecipients()).not.toContain("agent-alpha");
    });
  });

  describe("full delivery lifecycle", () => {
    it("staged then committed produces correct ledger call order", () => {
      const msg = makeEnvelope();
      inbox.stage(msg);
      inbox.commit("agent-alpha");

      const calls = vi.mocked(ledger.appendMessage).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0].deliveryStatus).toBe("staged");
      expect(calls[1][0].deliveryStatus).toBe("committed");
      expect(calls[0][0].messageId).toBe(calls[1][0].messageId);
    });

    it("full two-round lifecycle leaves correct state", () => {
      // Round 1
      inbox.stage(makeEnvelope({ messageId: "r1-alpha", roundNumber: 1, recipients: ["agent-alpha"] }));
      inbox.stage(makeEnvelope({ messageId: "r1-beta", roundNumber: 1, recipients: ["agent-beta"] }));
      inbox.commit("agent-alpha");
      inbox.commit("agent-beta");

      // Round 2
      inbox.stage(makeEnvelope({ messageId: "r2-alpha", roundNumber: 2, recipients: ["agent-alpha"] }));
      inbox.stage(makeEnvelope({ messageId: "r2-beta", roundNumber: 2, recipients: ["agent-beta"] }));
      inbox.commit("agent-alpha");

      expect(inbox.getCommitted("agent-alpha")).toHaveLength(2);
      expect(inbox.getCommitted("agent-beta")).toHaveLength(1);
      expect(inbox.getStaged("agent-beta")).toHaveLength(1);
      expect(inbox.stagedRecipients()).toContain("agent-beta");
      expect(inbox.stagedRecipients()).not.toContain("agent-alpha");
    });
  });

  describe("rehydrate", () => {
    it("clears existing in-memory state before rebuilding", () => {
      inbox.stage(makeEnvelope({ messageId: "pre-existing" }));
      inbox.rehydrate([]);
      expect(inbox.getStaged("agent-alpha")).toHaveLength(0);
      expect(inbox.stagedRecipients()).toHaveLength(0);
    });

    it("rebuilds staged state from a list of staged messages", () => {
      const msg = makeEnvelope({ messageId: "msg-r1", deliveryStatus: "staged" });
      inbox.rehydrate([msg]);
      expect(inbox.getStaged("agent-alpha")).toHaveLength(1);
      expect(inbox.getStaged("agent-alpha")[0].messageId).toBe("msg-r1");
    });

    it("rebuilds committed state from a list of committed messages", () => {
      const msg = makeEnvelope({
        messageId: "msg-r1",
        deliveryStatus: "committed",
      });
      inbox.rehydrate([msg]);
      expect(inbox.getCommitted("agent-alpha")).toHaveLength(1);
      expect(inbox.getStaged("agent-alpha")).toHaveLength(0);
    });

    it("uses the last delivery status when a message appears staged then committed", () => {
      const staged = makeEnvelope({ messageId: "msg-r1", deliveryStatus: "staged" });
      const committed = makeEnvelope({
        messageId: "msg-r1",
        deliveryStatus: "committed",
      });
      inbox.rehydrate([staged, committed]);
      expect(inbox.getCommitted("agent-alpha")).toHaveLength(1);
      expect(inbox.getStaged("agent-alpha")).toHaveLength(0);
    });

    it("treats separate messages as independent even with the same recipient", () => {
      const msg1 = makeEnvelope({ messageId: "msg-r1", deliveryStatus: "committed" });
      const msg2 = makeEnvelope({ messageId: "msg-r2", deliveryStatus: "staged" });
      inbox.rehydrate([msg1, msg2]);
      expect(inbox.getCommitted("agent-alpha")).toHaveLength(1);
      expect(inbox.getStaged("agent-alpha")).toHaveLength(1);
    });

    it("rebuilds state for multiple recipients from a multi-recipient message", () => {
      const msg = makeEnvelope({
        messageId: "broadcast-1",
        recipients: ["agent-alpha", "agent-beta"],
        deliveryStatus: "staged",
      });
      inbox.rehydrate([msg]);
      expect(inbox.getStaged("agent-alpha")).toHaveLength(1);
      expect(inbox.getStaged("agent-beta")).toHaveLength(1);
    });

    it("rebuilds committed for one recipient and staged for another in a multi-recipient message", () => {
      const staged = makeEnvelope({
        messageId: "msg-1",
        recipients: ["agent-alpha", "agent-beta"],
        deliveryStatus: "staged",
      });
      const committedAlpha = makeEnvelope({
        messageId: "msg-1",
        recipients: ["agent-alpha"],
        deliveryStatus: "committed",
      });
      inbox.rehydrate([staged, committedAlpha]);
      expect(inbox.getCommitted("agent-alpha")).toHaveLength(1);
      expect(inbox.getStaged("agent-beta")).toHaveLength(1);
    });

    it("results in stagedRecipients() returning only recipients with staged messages", () => {
      const msg1 = makeEnvelope({ messageId: "m1", deliveryStatus: "committed" });
      const msg2 = makeEnvelope({
        messageId: "m2",
        recipients: ["agent-beta"],
        deliveryStatus: "staged",
      });
      inbox.rehydrate([msg1, msg2]);
      expect(inbox.stagedRecipients()).toEqual(["agent-beta"]);
    });

    it("handles an empty message list gracefully", () => {
      expect(() => inbox.rehydrate([])).not.toThrow();
      expect(inbox.stagedRecipients()).toHaveLength(0);
    });
  });
});
