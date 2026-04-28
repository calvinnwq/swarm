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
  startedAt: "2026-04-24T09:00:00.000Z",
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
    const parsed = RunCheckpointSchema.parse({
      ...valid,
      lastCompletedRound: 5,
    });
    expect(parsed.lastCompletedRound).toBe(5);
  });

  it("accepts checkpointed round results", () => {
    const parsed = RunCheckpointSchema.parse({
      ...valid,
      completedRoundResults: [
        {
          round: 1,
          packet: validPacket,
          agentResults: [
            {
              agent: "alpha",
              ok: true,
              output: {
                agent: "alpha",
                round: 1,
                stance: "support",
                recommendation: "ship",
                reasoning: ["basis"],
                objections: [],
                risks: [],
                changesFromPriorRound: [],
                confidence: "high",
                openQuestions: [],
              },
              error: null,
            },
          ],
        },
      ],
    });

    expect(parsed.completedRoundResults?.[0]?.agentResults[0]?.output).toEqual(
      expect.objectContaining({ reasoning: ["basis"] }),
    );
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

  it("accepts a checkpoint with startedAt", () => {
    const parsed = RunCheckpointSchema.parse(valid);
    expect(parsed.startedAt).toBe("2026-04-24T09:00:00.000Z");
  });

  it("rejects missing startedAt", () => {
    const { startedAt: _, ...rest } = valid;
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

  it("accepts a checkpoint with orchestratorPasses", () => {
    const parsed = RunCheckpointSchema.parse({
      ...valid,
      orchestratorPasses: [
        {
          round: 1,
          agentName: "orchestrator",
          output: {
            round: 2,
            directive: "tighten on Postgres",
            questionResolutions: [],
            questionResolutionLimit: 3,
            deferredQuestions: ["Rollout cadence?"],
            confidence: "high",
          },
        },
      ],
    });
    expect(parsed.orchestratorPasses).toEqual([
      expect.objectContaining({
        round: 1,
        agentName: "orchestrator",
        output: expect.objectContaining({
          directive: "tighten on Postgres",
          confidence: "high",
        }),
      }),
    ]);
  });

  it("rejects an orchestratorPasses entry missing the output field", () => {
    expect(() =>
      RunCheckpointSchema.parse({
        ...valid,
        orchestratorPasses: [{ round: 1, agentName: "orchestrator" }],
      }),
    ).toThrow();
  });

  it("rejects an orchestratorPasses entry with non-int round", () => {
    expect(() =>
      RunCheckpointSchema.parse({
        ...valid,
        orchestratorPasses: [
          {
            round: 1.5,
            agentName: "orchestrator",
            output: {
              round: 2,
              directive: "x",
              questionResolutions: [],
              questionResolutionLimit: 0,
              deferredQuestions: [],
              confidence: "low",
            },
          },
        ],
      }),
    ).toThrow();
  });
});
