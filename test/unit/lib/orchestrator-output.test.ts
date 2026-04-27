import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildOrchestratorRepairPrompt,
  extractOrchestratorOutputJson,
  validateOrchestratorOutput,
} from "../../../src/lib/orchestrator-output.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/orchestrator-output-sample.json", import.meta.url),
);
const sampleJson = readFileSync(fixturePath, "utf-8");
const sample = JSON.parse(sampleJson);

describe("extractOrchestratorOutputJson", () => {
  it("returns undefined when there is no JSON in the input", () => {
    expect(extractOrchestratorOutputJson("no json here")).toBeUndefined();
  });

  it("extracts a bare JSON object", () => {
    expect(extractOrchestratorOutputJson(sampleJson)).toEqual(sample);
  });

  it("extracts a JSON object inside a fenced ```json block", () => {
    const wrapped = `Here is the orchestrator output:\n\n\`\`\`json\n${sampleJson}\n\`\`\`\n`;
    expect(extractOrchestratorOutputJson(wrapped)).toEqual(sample);
  });

  it("prefers a candidate that matches the orchestrator schema over an unrelated one", () => {
    const decoy = { foo: "bar" };
    const wrapped = `prelude ${JSON.stringify(decoy)} more text\n\`\`\`json\n${sampleJson}\n\`\`\``;
    expect(extractOrchestratorOutputJson(wrapped)).toEqual(sample);
  });
});

describe("validateOrchestratorOutput", () => {
  it("returns ok=true with the parsed output for a valid payload", () => {
    const result = validateOrchestratorOutput(sampleJson);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.directive).toMatch(/Round 2/);
      expect(result.output.questionResolutions.length).toBe(2);
    }
  });

  it("returns ok=false with an actionable error when JSON cannot be extracted", () => {
    const result = validateOrchestratorOutput("not json at all");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/extract/i);
    }
  });

  it("returns ok=false with an actionable error when schema validation fails", () => {
    const broken = { ...sample };
    delete broken.directive;
    const result = validateOrchestratorOutput(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Schema validation failed/);
    }
  });
});

describe("buildOrchestratorRepairPrompt", () => {
  it("includes the original brief, the validation error, and the invalid stdout", () => {
    const prompt = buildOrchestratorRepairPrompt(
      "ORIG_BRIEF",
      "Schema validation failed: missing directive",
      "BAD_STDOUT",
    );
    expect(prompt).toContain("ORIG_BRIEF");
    expect(prompt).toContain("Schema validation failed: missing directive");
    expect(prompt).toContain("BAD_STDOUT");
  });

  it("enumerates the required orchestrator output fields", () => {
    const prompt = buildOrchestratorRepairPrompt("brief", "err", "stdout");
    for (const field of [
      "round",
      "directive",
      "questionResolutions",
      "questionResolutionLimit",
      "deferredQuestions",
      "confidence",
    ]) {
      expect(prompt).toContain(field);
    }
  });

  it("instructs the orchestrator not to wrap output in fences or prose", () => {
    const prompt = buildOrchestratorRepairPrompt("brief", "err", "stdout");
    expect(prompt.toLowerCase()).toMatch(/no.*(prose|markdown|fence)/);
  });
});
