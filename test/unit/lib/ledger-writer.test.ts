import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { LedgerWriter } from "../../../src/lib/ledger-writer.js";
import type { MessageEnvelope } from "../../../src/schemas/message.js";
import type { RunEvent } from "../../../src/schemas/run-event.js";

function makeMessage(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return {
    messageId: "msg-001",
    senderId: "orchestrator",
    recipients: ["agent-alpha"],
    kind: "task",
    payload: { instruction: "analyze this" },
    deliveryStatus: "staged",
    createdAt: "2026-04-24T03:00:00.000Z",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RunEvent> = {}): RunEvent {
  return {
    eventId: "evt-001",
    kind: "run:started",
    runId: "00000000-0000-0000-0000-000000000001",
    occurredAt: "2026-04-24T03:00:00.000Z",
    ...overrides,
  };
}

let testDir: string;
let runDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `ledger-writer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  runDir = join(testDir, "run-001");
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("LedgerWriter", () => {
  describe("init", () => {
    it("creates the run directory", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      expect(existsSync(runDir)).toBe(true);
    });

    it("creates empty messages.jsonl and events.jsonl files", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      expect(existsSync(join(runDir, "messages.jsonl"))).toBe(true);
      expect(existsSync(join(runDir, "events.jsonl"))).toBe(true);
    });

    it("exposes messagesPath and eventsPath pointing inside runDir", () => {
      const ledger = new LedgerWriter(runDir);
      expect(ledger.messagesPath).toBe(join(runDir, "messages.jsonl"));
      expect(ledger.eventsPath).toBe(join(runDir, "events.jsonl"));
    });

    it("is idempotent when called on an existing directory", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      expect(() => ledger.init()).not.toThrow();
    });
  });

  describe("appendMessage", () => {
    it("writes a JSONL line to messages.jsonl", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      const msg = makeMessage();

      ledger.appendMessage(msg);

      const raw = readFileSync(ledger.messagesPath, "utf-8").trim();
      const parsed = JSON.parse(raw);
      expect(parsed.messageId).toBe("msg-001");
      expect(parsed.senderId).toBe("orchestrator");
    });

    it("appends multiple messages in insertion order", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();

      ledger.appendMessage(makeMessage({ messageId: "msg-001" }));
      ledger.appendMessage(makeMessage({ messageId: "msg-002" }));
      ledger.appendMessage(makeMessage({ messageId: "msg-003" }));

      const lines = readFileSync(ledger.messagesPath, "utf-8")
        .split("\n")
        .filter(Boolean);
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]).messageId).toBe("msg-001");
      expect(JSON.parse(lines[1]).messageId).toBe("msg-002");
      expect(JSON.parse(lines[2]).messageId).toBe("msg-003");
    });

    it("each line is valid standalone JSON", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      ledger.appendMessage(makeMessage({ messageId: "msg-001" }));
      ledger.appendMessage(makeMessage({ messageId: "msg-002" }));

      const lines = readFileSync(ledger.messagesPath, "utf-8")
        .split("\n")
        .filter(Boolean);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    it("throws ZodError for invalid message (missing required field)", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      // @ts-expect-error intentionally invalid
      expect(() => ledger.appendMessage({ messageId: "bad" })).toThrow();
    });

    it("does not write anything when validation fails", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      try {
        // @ts-expect-error intentionally invalid
        ledger.appendMessage({ messageId: "bad" });
      } catch {}
      const content = readFileSync(ledger.messagesPath, "utf-8");
      expect(content.trim()).toBe("");
    });
  });

  describe("appendEvent", () => {
    it("writes a JSONL line to events.jsonl", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      const event = makeEvent();

      ledger.appendEvent(event);

      const raw = readFileSync(ledger.eventsPath, "utf-8").trim();
      const parsed = JSON.parse(raw);
      expect(parsed.eventId).toBe("evt-001");
      expect(parsed.kind).toBe("run:started");
    });

    it("appends multiple events in insertion order", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();

      ledger.appendEvent(makeEvent({ eventId: "evt-001", kind: "run:started" }));
      ledger.appendEvent(makeEvent({ eventId: "evt-002", kind: "round:started", roundNumber: 1 }));
      ledger.appendEvent(makeEvent({ eventId: "evt-003", kind: "round:completed", roundNumber: 1 }));
      ledger.appendEvent(makeEvent({ eventId: "evt-004", kind: "run:completed" }));

      const lines = readFileSync(ledger.eventsPath, "utf-8")
        .split("\n")
        .filter(Boolean);
      expect(lines).toHaveLength(4);
      expect(JSON.parse(lines[0]).kind).toBe("run:started");
      expect(JSON.parse(lines[1]).kind).toBe("round:started");
      expect(JSON.parse(lines[2]).kind).toBe("round:completed");
      expect(JSON.parse(lines[3]).kind).toBe("run:completed");
    });

    it("persists optional roundNumber and agentName fields", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      ledger.appendEvent(
        makeEvent({ kind: "agent:completed", roundNumber: 2, agentName: "alpha" }),
      );

      const raw = readFileSync(ledger.eventsPath, "utf-8").trim();
      const parsed = JSON.parse(raw);
      expect(parsed.roundNumber).toBe(2);
      expect(parsed.agentName).toBe("alpha");
    });

    it("throws ZodError for invalid event (unknown kind)", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      // @ts-expect-error intentionally invalid kind
      expect(() => ledger.appendEvent({ ...makeEvent(), kind: "bad:kind" })).toThrow();
    });

    it("does not write anything when validation fails", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      try {
        // @ts-expect-error intentionally invalid
        ledger.appendEvent({ eventId: "bad" });
      } catch {}
      const content = readFileSync(ledger.eventsPath, "utf-8");
      expect(content.trim()).toBe("");
    });
  });

  describe("readMessages", () => {
    it("returns empty array for an empty ledger file", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      expect(ledger.readMessages()).toEqual([]);
    });

    it("returns empty array when ledger file does not exist", () => {
      const ledger = new LedgerWriter(runDir);
      // do not call init — file does not exist
      expect(ledger.readMessages()).toEqual([]);
    });

    it("returns all messages in insertion order", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      const m1 = makeMessage({ messageId: "msg-001" });
      const m2 = makeMessage({ messageId: "msg-002", kind: "response" });
      ledger.appendMessage(m1);
      ledger.appendMessage(m2);

      const messages = ledger.readMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0].messageId).toBe("msg-001");
      expect(messages[1].messageId).toBe("msg-002");
      expect(messages[1].kind).toBe("response");
    });

    it("parses causal fields when present", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      ledger.appendMessage(
        makeMessage({ messageId: "msg-A", parentId: "msg-root", causationId: "msg-root" }),
      );

      const [msg] = ledger.readMessages();
      expect(msg.parentId).toBe("msg-root");
      expect(msg.causationId).toBe("msg-root");
    });
  });

  describe("readEvents", () => {
    it("returns empty array for an empty ledger file", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      expect(ledger.readEvents()).toEqual([]);
    });

    it("returns empty array when ledger file does not exist", () => {
      const ledger = new LedgerWriter(runDir);
      expect(ledger.readEvents()).toEqual([]);
    });

    it("returns all events in insertion order with full run lifecycle", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      ledger.appendEvent(makeEvent({ eventId: "e1", kind: "run:started" }));
      ledger.appendEvent(makeEvent({ eventId: "e2", kind: "round:started", roundNumber: 1 }));
      ledger.appendEvent(makeEvent({ eventId: "e3", kind: "round:completed", roundNumber: 1 }));
      ledger.appendEvent(makeEvent({ eventId: "e4", kind: "run:completed" }));

      const events = ledger.readEvents();
      expect(events).toHaveLength(4);
      expect(events.map((e) => e.kind)).toEqual([
        "run:started",
        "round:started",
        "round:completed",
        "run:completed",
      ]);
    });
  });

  describe("OutputTarget interface", () => {
    it("implements writeRound as no-op without throwing", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      // @ts-expect-error passing null for RoundResult/brief — no-op so irrelevant
      expect(() => ledger.writeRound(null, "")).not.toThrow();
    });

    it("implements writeSynthesis as no-op without throwing", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      // @ts-expect-error passing null for SynthesisResult — no-op so irrelevant
      expect(() => ledger.writeSynthesis(null)).not.toThrow();
    });

    it("implements finalize as no-op without throwing", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      expect(() =>
        ledger.finalize("2026-04-24T03:00:00.000Z", "done"),
      ).not.toThrow();
    });
  });

  describe("getLastCompletedRound", () => {
    it("returns 0 when no events have been written", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      expect(ledger.getLastCompletedRound()).toBe(0);
    });

    it("returns 0 when only non-round-completed events exist", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      ledger.appendEvent(makeEvent({ kind: "run:started" }));
      ledger.appendEvent(makeEvent({ kind: "round:started", roundNumber: 1 }));
      expect(ledger.getLastCompletedRound()).toBe(0);
    });

    it("returns the round number when one round:completed event exists", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      ledger.appendEvent(makeEvent({ kind: "round:completed", roundNumber: 1 }));
      expect(ledger.getLastCompletedRound()).toBe(1);
    });

    it("returns the highest round number when multiple rounds are completed", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      ledger.appendEvent(makeEvent({ kind: "round:completed", roundNumber: 1 }));
      ledger.appendEvent(makeEvent({ kind: "round:completed", roundNumber: 2 }));
      ledger.appendEvent(makeEvent({ kind: "round:completed", roundNumber: 3 }));
      expect(ledger.getLastCompletedRound()).toBe(3);
    });

    it("ignores round:started events when counting completed rounds", () => {
      const ledger = new LedgerWriter(runDir);
      ledger.init();
      ledger.appendEvent(makeEvent({ kind: "round:started", roundNumber: 1 }));
      ledger.appendEvent(makeEvent({ kind: "round:completed", roundNumber: 1 }));
      ledger.appendEvent(makeEvent({ kind: "round:started", roundNumber: 2 }));
      // round 2 started but not completed
      expect(ledger.getLastCompletedRound()).toBe(1);
    });

    it("returns 0 when the ledger file does not exist", () => {
      const ledger = new LedgerWriter(join(runDir, "nonexistent"));
      expect(ledger.getLastCompletedRound()).toBe(0);
    });
  });
});
