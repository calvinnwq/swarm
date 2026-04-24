import { describe, expect, it } from "vitest";
import {
  RunEventSchema,
  ALLOWED_RUN_STATUS_TRANSITIONS,
  isAllowedRunStatusTransition,
} from "../../../src/schemas/index.js";

const validEvent = {
  eventId: "evt-001",
  kind: "run:started" as const,
  runId: "00000000-0000-0000-0000-000000000001",
  occurredAt: "2026-04-24T00:00:00.000Z",
};

describe("RunEventSchema", () => {
  it("accepts a minimal run:started event", () => {
    const parsed = RunEventSchema.parse(validEvent);
    expect(parsed.eventId).toBe("evt-001");
    expect(parsed.kind).toBe("run:started");
    expect(parsed.roundNumber).toBeUndefined();
    expect(parsed.agentName).toBeUndefined();
    expect(parsed.metadata).toBeUndefined();
  });

  it("accepts round-scoped events with roundNumber", () => {
    const parsed = RunEventSchema.parse({ ...validEvent, kind: "round:started", roundNumber: 1 });
    expect(parsed.kind).toBe("round:started");
    expect(parsed.roundNumber).toBe(1);
  });

  it("accepts agent-scoped events with agentName", () => {
    const parsed = RunEventSchema.parse({
      ...validEvent,
      kind: "agent:completed",
      roundNumber: 2,
      agentName: "alpha",
    });
    expect(parsed.agentName).toBe("alpha");
  });

  it("accepts optional metadata", () => {
    const parsed = RunEventSchema.parse({ ...validEvent, metadata: { durationMs: 1200 } });
    expect(parsed.metadata).toEqual({ durationMs: 1200 });
  });

  it("rejects unknown kind", () => {
    expect(RunEventSchema.safeParse({ ...validEvent, kind: "run:paused" }).success).toBe(false);
  });

  it("rejects missing runId", () => {
    const { runId: _, ...rest } = validEvent;
    expect(RunEventSchema.safeParse(rest).success).toBe(false);
  });

  it("accepts all valid event kinds", () => {
    const kinds = [
      "run:started",
      "run:completed",
      "run:failed",
      "round:started",
      "round:completed",
      "agent:started",
      "agent:completed",
      "agent:failed",
    ] as const;
    for (const kind of kinds) {
      expect(RunEventSchema.safeParse({ ...validEvent, kind }).success).toBe(true);
    }
  });
});

describe("ALLOWED_RUN_STATUS_TRANSITIONS", () => {
  it("pending may transition to running or failed", () => {
    expect(ALLOWED_RUN_STATUS_TRANSITIONS.pending.has("running")).toBe(true);
    expect(ALLOWED_RUN_STATUS_TRANSITIONS.pending.has("failed")).toBe(true);
    expect(ALLOWED_RUN_STATUS_TRANSITIONS.pending.has("done")).toBe(false);
  });

  it("running may transition to done or failed", () => {
    expect(ALLOWED_RUN_STATUS_TRANSITIONS.running.has("done")).toBe(true);
    expect(ALLOWED_RUN_STATUS_TRANSITIONS.running.has("failed")).toBe(true);
    expect(ALLOWED_RUN_STATUS_TRANSITIONS.running.has("pending")).toBe(false);
  });

  it("done is terminal — no transitions allowed", () => {
    expect(ALLOWED_RUN_STATUS_TRANSITIONS.done.size).toBe(0);
  });

  it("failed is terminal — no transitions allowed", () => {
    expect(ALLOWED_RUN_STATUS_TRANSITIONS.failed.size).toBe(0);
  });
});

describe("isAllowedRunStatusTransition", () => {
  it("returns true for valid transitions", () => {
    expect(isAllowedRunStatusTransition("pending", "running")).toBe(true);
    expect(isAllowedRunStatusTransition("running", "done")).toBe(true);
    expect(isAllowedRunStatusTransition("running", "failed")).toBe(true);
    expect(isAllowedRunStatusTransition("pending", "failed")).toBe(true);
  });

  it("returns false for invalid transitions", () => {
    expect(isAllowedRunStatusTransition("done", "running")).toBe(false);
    expect(isAllowedRunStatusTransition("failed", "running")).toBe(false);
    expect(isAllowedRunStatusTransition("pending", "done")).toBe(false);
    expect(isAllowedRunStatusTransition("running", "pending")).toBe(false);
    expect(isAllowedRunStatusTransition("done", "failed")).toBe(false);
  });
});
