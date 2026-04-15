import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RoundPacketSchema,
  type AgentOutput,
} from "../../../src/schemas/index.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/agent-output-sample.json", import.meta.url),
);
const sample = JSON.parse(readFileSync(fixturePath, "utf-8")) as AgentOutput;

function buildPacket() {
  return {
    round: sample.round,
    agents: [sample.agent],
    summaries: [
      {
        agent: sample.agent,
        stance: sample.stance,
        recommendation: sample.recommendation,
        objections: sample.objections,
        risks: sample.risks,
        confidence: sample.confidence,
        openQuestions: sample.openQuestions,
      },
    ],
    keyObjections: sample.objections,
    sharedRisks: sample.risks,
    openQuestions: sample.openQuestions,
    questionResolutions: [],
    questionResolutionLimit: 3,
    deferredQuestions: [],
  };
}

describe("RoundPacketSchema", () => {
  it("accepts a packet shape derived from a representative agent output", () => {
    const parsed = RoundPacketSchema.parse(buildPacket());
    expect(parsed.round).toBe(sample.round);
    expect(parsed.summaries[0].agent).toBe(sample.agent);
  });

  it("rejects a missing summaries field", () => {
    const broken = buildPacket() as Record<string, unknown>;
    delete broken.summaries;
    expect(RoundPacketSchema.safeParse(broken).success).toBe(false);
  });
});
