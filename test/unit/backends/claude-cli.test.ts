import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractJson,
  parseAgentOutput,
} from "../../../src/backends/claude-cli.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/agent-output-sample.json", import.meta.url),
);
const sampleJson = readFileSync(fixturePath, "utf-8");
const sampleObj = JSON.parse(sampleJson);

describe("extractJson", () => {
  it("parses pure JSON", () => {
    expect(extractJson(sampleJson)).toEqual(sampleObj);
  });

  it("parses JSON inside ```json fences", () => {
    const wrapped = `Here is the output:\n\n\`\`\`json\n${sampleJson}\n\`\`\`\n\nHope that helps!`;
    expect(extractJson(wrapped)).toEqual(sampleObj);
  });

  it("parses JSON inside bare ``` fences", () => {
    const wrapped = `\`\`\`\n${sampleJson}\n\`\`\``;
    expect(extractJson(wrapped)).toEqual(sampleObj);
  });

  it("extracts JSON with leading prose", () => {
    const wrapped = `Here is my analysis as the alpha agent:\n\n${sampleJson}`;
    expect(extractJson(wrapped)).toEqual(sampleObj);
  });

  it("extracts JSON with trailing junk", () => {
    const wrapped = `${sampleJson}\n\nLet me know if you need anything else.`;
    expect(extractJson(wrapped)).toEqual(sampleObj);
  });

  it("extracts JSON with both leading and trailing prose", () => {
    const wrapped = `Sure! Here is the output:\n${sampleJson}\nDone.`;
    expect(extractJson(wrapped)).toEqual(sampleObj);
  });

  it("returns undefined for non-JSON text", () => {
    expect(
      extractJson("This is just plain text with no JSON."),
    ).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    expect(extractJson('{ "broken": ')).toBeUndefined();
  });

  it("handles whitespace-padded JSON", () => {
    const padded = `\n\n  ${sampleJson}  \n\n`;
    expect(extractJson(padded)).toEqual(sampleObj);
  });
});

describe("parseAgentOutput", () => {
  it("parses valid agent output from pure JSON", () => {
    const output = parseAgentOutput(sampleJson);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("parses valid agent output from fenced JSON", () => {
    const wrapped = `\`\`\`json\n${sampleJson}\n\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
  });

  it("throws on text with no extractable JSON", () => {
    expect(() => parseAgentOutput("no json here")).toThrow(
      /Failed to extract JSON/,
    );
  });

  it("throws on valid JSON that fails schema validation", () => {
    const invalid = JSON.stringify({ agent: "a", round: 1 });
    expect(() => parseAgentOutput(invalid)).toThrow();
  });

  it("includes raw stdout in the error for non-extractable output", () => {
    const garbage = "total garbage output";
    try {
      parseAgentOutput(garbage);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain(garbage);
    }
  });
});
