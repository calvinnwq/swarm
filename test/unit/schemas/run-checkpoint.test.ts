import { describe, expect, it } from "vitest";
import { RunCheckpointSchema } from "../../../src/schemas/index.js";

const validPacket = {
  round: 1,
  agents: ["alpha", "beta"],
  summaries: [],
  keyObjections: [],
  sharedRisks: [],
  openQuestions: [],
  questionResolutions: [],
  questionResolutionLimit: 3,
  deferredQuestions: [],
};

const valid = {
  runId: "00000000-0000-0000-0000-000000000001",
  lastCompletedRound: 1,
  priorPacket: validPacket,
  checkpointedAt: "2026-04-24T10:00:00.000Z",
};

describe("RunCheckpointSchema", () => {
  it("accepts a minimal checkpoint without orchestratorDirective", () => {
    const parsed = RunCheckpointSchema.parse(valid);
    expect(parsed.runId).toBe("00000000-0000-0000-0000-000000000001");
    expect(parsed.lastCompletedRound).toBe(1);
    expect(parsed.orchestratorDirective).toBeUndefined();
  });

  it("accepts a checkpoint with orchestratorDirective", () => {
    const parsed = RunCheckpointSchema.parse({
      ...valid,
      orchestratorDirective: "Consider aligning on risk tolerance.",
    });
    expect(parsed.orchestratorDirective).toBe(
      "Consider aligning on risk tolerance.",
    );
  });

  it("accepts lastCompletedRound > 1", () => {
    const parsed = RunCheckpointSchema.parse({ ...valid, lastCompletedRound: 5 });
    expect(parsed.lastCompletedRound).toBe(5);
  });

  it("rejects lastCompletedRound of 0", () => {
    expect(() =>
      RunCheckpointSchema.parse({ ...valid, lastCompletedRound: 0 }),
    ).toThrow();
  });

  it("rejects missing runId", () => {
    const { runId: _, ...rest } = valid;
    expect(() => RunCheckpointSchema.parse(rest)).toThrow();
  });

  it("rejects missing priorPacket", () => {
    const { priorPacket: _, ...rest } = valid;
    expect(() => RunCheckpointSchema.parse(rest)).toThrow();
  });

  it("rejects invalid checkpointedAt", () => {
    expect(() =>
      RunCheckpointSchema.parse({ ...valid, checkpointedAt: "not-a-date" }),
    ).toThrow();
  });

  it("round-trips a full checkpoint through JSON", () => {
    const checkpoint = RunCheckpointSchema.parse({
      ...valid,
      orchestratorDirective: "Focus on open questions.",
    });
    const roundTripped = RunCheckpointSchema.parse(
      JSON.parse(JSON.stringify(checkpoint)),
    );
    expect(roundTripped).toEqual(checkpoint);
  });
});
