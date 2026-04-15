import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentOutputSchema } from "../../../src/schemas/index.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/agent-output-sample.json", import.meta.url),
);
const sample = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("AgentOutputSchema", () => {
  it("accepts a representative agent output and round-trips through JSON", () => {
    const parsed = AgentOutputSchema.parse(sample);
    expect(parsed.agent).toBe("alpha");
    expect(parsed.round).toBe(2);
    expect(parsed.confidence).toBe("high");
    expect(parsed.reasoning.length).toBeGreaterThan(0);

    const reparsed = AgentOutputSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it("rejects when a required core field is missing", () => {
    const broken = { ...sample };
    delete broken.recommendation;
    const result = AgentOutputSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.path.includes("recommendation"),
      );
      expect(issue).toBeDefined();
    }
  });

  it("rejects when confidence is outside the enum", () => {
    const broken = { ...sample, confidence: "ultra-high" };
    expect(AgentOutputSchema.safeParse(broken).success).toBe(false);
  });

  it("passes through unknown extra fields without dropping them", () => {
    const augmented = { ...sample, extraField: "future-feature" };
    const parsed = AgentOutputSchema.parse(augmented);
    expect((parsed as Record<string, unknown>).extraField).toBe(
      "future-feature",
    );
  });
});
