import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OrchestratorOutputSchema } from "../../../src/schemas/index.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/orchestrator-output-sample.json", import.meta.url),
);
const sample = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("OrchestratorOutputSchema", () => {
  it("accepts a representative orchestrator output and round-trips through JSON", () => {
    const parsed = OrchestratorOutputSchema.parse(sample);
    expect(parsed.round).toBe(1);
    expect(parsed.directive).toMatch(/Round 2/);
    expect(parsed.questionResolutions.length).toBe(2);
    expect(parsed.questionResolutions[0].status).toBe("consensus");
    expect(parsed.questionResolutionLimit).toBe(3);
    expect(parsed.deferredQuestions).toEqual([
      "Should the data layer be decoupled from the transport before round 3, or after the slice is live?",
    ]);
    expect(parsed.confidence).toBe("medium");

    const reparsed = OrchestratorOutputSchema.parse(
      JSON.parse(JSON.stringify(parsed)),
    );
    expect(reparsed).toEqual(parsed);
  });

  it("rejects when a required core field is missing", () => {
    const broken = { ...sample };
    delete broken.directive;
    const result = OrchestratorOutputSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.path.includes("directive"),
      );
      expect(issue).toBeDefined();
    }
  });

  it("rejects when questionResolutions is not an array", () => {
    const broken = { ...sample, questionResolutions: "n/a" };
    expect(OrchestratorOutputSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects when questionResolutionLimit is negative", () => {
    const broken = { ...sample, questionResolutionLimit: -1 };
    expect(OrchestratorOutputSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects when a question resolution has an out-of-enum status", () => {
    const broken = {
      ...sample,
      questionResolutions: [
        {
          ...sample.questionResolutions[0],
          status: "maybe",
        },
        sample.questionResolutions[1],
      ],
    };
    expect(OrchestratorOutputSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects when a question resolution has an out-of-enum confidence", () => {
    const broken = {
      ...sample,
      questionResolutions: [
        {
          ...sample.questionResolutions[0],
          confidence: "ultra-high",
        },
        sample.questionResolutions[1],
      ],
    };
    expect(OrchestratorOutputSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects when top-level confidence is outside the enum", () => {
    const broken = { ...sample, confidence: "ultra-high" };
    expect(OrchestratorOutputSchema.safeParse(broken).success).toBe(false);
  });

  it("passes through unknown extra fields without dropping them", () => {
    const augmented = { ...sample, extraField: "future-feature" };
    const parsed = OrchestratorOutputSchema.parse(augmented);
    expect((parsed as Record<string, unknown>).extraField).toBe(
      "future-feature",
    );
  });

  it("accepts an empty resolutions array as long as the directive is present", () => {
    const minimal = {
      round: 1,
      directive: "No resolutions yet; converge in round 2.",
      questionResolutions: [],
      questionResolutionLimit: 0,
      deferredQuestions: [],
      confidence: "low",
    };
    const parsed = OrchestratorOutputSchema.parse(minimal);
    expect(parsed.questionResolutions).toEqual([]);
    expect(parsed.questionResolutionLimit).toBe(0);
  });
});
