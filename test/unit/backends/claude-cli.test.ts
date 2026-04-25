import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import {
  ClaudeCliAdapter,
  extractAgentOutputJson,
  extractJson,
  parseAgentOutput,
} from "../../../src/backends/claude-cli.js";
import type { AgentDefinition } from "../../../src/schemas/index.js";

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

  it("extracts JSON when leading prose contains stray braces", () => {
    const wrapped = `Agent note: {not actually json}\n\n${sampleJson}`;
    expect(extractJson(wrapped)).toEqual(sampleObj);
  });

  it("extracts JSON when trailing prose contains stray braces", () => {
    const wrapped = `${sampleJson}\n\nAgent note: {not actually json}`;
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

  it("parses valid agent output from bare fenced JSON", () => {
    const wrapped = `\`\`\`\n${sampleJson}\n\`\`\``;
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

  it("prefers a later schema-invalid agent-like payload over earlier irrelevant JSON when no candidate is fully valid", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `${JSON.stringify({ note: "ignore me" })}\n\n${JSON.stringify(invalidAgentLike)}`;

    expect(extractAgentOutputJson(wrapped)).toEqual(invalidAgentLike);
  });

  it("prefers a later schema-invalid agent-like payload over earlier irrelevant json-fenced JSON when no candidate is fully valid", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `\`\`\`json
${JSON.stringify({ note: "ignore fenced metadata" })}
\`\`\`

${JSON.stringify(invalidAgentLike)}`;

    expect(extractAgentOutputJson(wrapped)).toEqual(invalidAgentLike);
  });

  it("prefers a later schema-invalid agent-like payload over earlier irrelevant bare-fenced JSON when no candidate is fully valid", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `\`\`\`
${JSON.stringify({ note: "ignore bare fenced metadata" })}
\`\`\`

${JSON.stringify(invalidAgentLike)}`;

    expect(extractAgentOutputJson(wrapped)).toEqual(invalidAgentLike);
  });

  it("prefers a later schema-invalid agent-like payload over earlier malformed plain JSON when no candidate is fully valid", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `{ "broken": \n\n${JSON.stringify(invalidAgentLike)}`;

    expect(extractAgentOutputJson(wrapped)).toEqual(invalidAgentLike);
  });

  it("prefers a later schema-invalid agent-like payload over earlier malformed fenced JSON when no candidate is fully valid", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `\`\`\`json
{ "broken": 
\`\`\`

${JSON.stringify(invalidAgentLike)}`;

    expect(extractAgentOutputJson(wrapped)).toEqual(invalidAgentLike);
  });

  it("prefers a later schema-invalid agent-like payload over earlier malformed bare-fenced JSON when no candidate is fully valid", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `\`\`\`
{ "broken": 
\`\`\`

${JSON.stringify(invalidAgentLike)}`;

    expect(extractAgentOutputJson(wrapped)).toEqual(invalidAgentLike);
  });

  it("prefers the first schema-invalid agent-like payload when multiple agent-like candidates are invalid", () => {
    const firstInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "keep first invalid payload",
      reasoning: ["reason 1"],
      objections: ["objection 1"],
      risks: ["risk 1"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 1"],
    };
    const laterInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation instead",
      reasoning: ["reason 2"],
      objections: ["objection 2"],
      risks: ["risk 2"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 2"],
    };
    const wrapped = `${JSON.stringify(firstInvalidAgentLike)}\n\n\`\`\`json\n${JSON.stringify(laterInvalidAgentLike)}\n\`\`\``;

    expect(extractAgentOutputJson(wrapped)).toEqual(firstInvalidAgentLike);
  });

  it("prefers the first json-fenced schema-invalid agent-like payload when a later plain agent-like payload is also invalid", () => {
    const firstInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "keep fenced invalid payload",
      reasoning: ["reason 1"],
      objections: ["objection 1"],
      risks: ["risk 1"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 1"],
    };
    const laterInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation instead",
      reasoning: ["reason 2"],
      objections: ["objection 2"],
      risks: ["risk 2"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 2"],
    };
    const wrapped = `\`\`\`json
${JSON.stringify(firstInvalidAgentLike)}
\`\`\`

${JSON.stringify(laterInvalidAgentLike)}`;

    expect(extractAgentOutputJson(wrapped)).toEqual(firstInvalidAgentLike);
  });

  it("prefers the first json-fenced schema-invalid agent-like payload when a later bare-fenced agent-like payload is also invalid", () => {
    const firstInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "keep json-fenced invalid payload",
      reasoning: ["reason 1"],
      objections: ["objection 1"],
      risks: ["risk 1"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 1"],
    };
    const laterInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation instead",
      reasoning: ["reason 2"],
      objections: ["objection 2"],
      risks: ["risk 2"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 2"],
    };
    const wrapped = `\`\`\`json
${JSON.stringify(firstInvalidAgentLike)}
\`\`\`

\`\`\`
${JSON.stringify(laterInvalidAgentLike)}
\`\`\``;

    expect(extractAgentOutputJson(wrapped)).toEqual(firstInvalidAgentLike);
  });

  it("prefers the first json-fenced schema-invalid agent-like payload when a later json-fenced agent-like payload is also invalid", () => {
    const firstInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "keep first json-fenced invalid payload",
      reasoning: ["reason 1"],
      objections: ["objection 1"],
      risks: ["risk 1"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 1"],
    };
    const laterInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation instead",
      reasoning: ["reason 2"],
      objections: ["objection 2"],
      risks: ["risk 2"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 2"],
    };
    const wrapped = `\`\`\`json
${JSON.stringify(firstInvalidAgentLike)}
\`\`\`

\`\`\`json
${JSON.stringify(laterInvalidAgentLike)}
\`\`\``;

    expect(extractAgentOutputJson(wrapped)).toEqual(firstInvalidAgentLike);
  });

  it("prefers the first bare-fenced schema-invalid agent-like payload when a later plain agent-like payload is also invalid", () => {
    const firstInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "keep bare-fenced invalid payload",
      reasoning: ["reason 1"],
      objections: ["objection 1"],
      risks: ["risk 1"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 1"],
    };
    const laterInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation instead",
      reasoning: ["reason 2"],
      objections: ["objection 2"],
      risks: ["risk 2"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 2"],
    };
    const wrapped = `\`\`\`
${JSON.stringify(firstInvalidAgentLike)}
\`\`\`

${JSON.stringify(laterInvalidAgentLike)}`;

    expect(extractAgentOutputJson(wrapped)).toEqual(firstInvalidAgentLike);
  });

  it("prefers the first bare-fenced schema-invalid agent-like payload when a later json-fenced agent-like payload is also invalid", () => {
    const firstInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "keep bare-fenced invalid payload",
      reasoning: ["reason 1"],
      objections: ["objection 1"],
      risks: ["risk 1"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 1"],
    };
    const laterInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation instead",
      reasoning: ["reason 2"],
      objections: ["objection 2"],
      risks: ["risk 2"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 2"],
    };
    const wrapped = `\`\`\`
${JSON.stringify(firstInvalidAgentLike)}
\`\`\`

\`\`\`json
${JSON.stringify(laterInvalidAgentLike)}
\`\`\``;

    expect(extractAgentOutputJson(wrapped)).toEqual(firstInvalidAgentLike);
  });

  it("prefers the first bare-fenced schema-invalid agent-like payload when a later bare-fenced agent-like payload is also invalid", () => {
    const firstInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "keep first bare-fenced invalid payload",
      reasoning: ["reason 1"],
      objections: ["objection 1"],
      risks: ["risk 1"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 1"],
    };
    const laterInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation instead",
      reasoning: ["reason 2"],
      objections: ["objection 2"],
      risks: ["risk 2"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 2"],
    };
    const wrapped = `\`\`\`
${JSON.stringify(firstInvalidAgentLike)}
\`\`\`

\`\`\`
${JSON.stringify(laterInvalidAgentLike)}
\`\`\``;

    expect(extractAgentOutputJson(wrapped)).toEqual(firstInvalidAgentLike);
  });

  it("prefers the first plain schema-invalid agent-like payload when a later bare-fenced agent-like payload is also invalid", () => {
    const firstInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "keep plain invalid payload",
      reasoning: ["reason 1"],
      objections: ["objection 1"],
      risks: ["risk 1"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 1"],
    };
    const laterInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation instead",
      reasoning: ["reason 2"],
      objections: ["objection 2"],
      risks: ["risk 2"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 2"],
    };
    const wrapped = `${JSON.stringify(firstInvalidAgentLike)}

\`\`\`
${JSON.stringify(laterInvalidAgentLike)}
\`\`\``;

    expect(extractAgentOutputJson(wrapped)).toEqual(firstInvalidAgentLike);
  });

  it("prefers the first plain schema-invalid agent-like payload when a later plain agent-like payload is also invalid", () => {
    const firstInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "keep first plain invalid payload",
      reasoning: ["reason 1"],
      objections: ["objection 1"],
      risks: ["risk 1"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 1"],
    };
    const laterInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation instead",
      reasoning: ["reason 2"],
      objections: ["objection 2"],
      risks: ["risk 2"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 2"],
    };
    const wrapped = `${JSON.stringify(firstInvalidAgentLike)}

${JSON.stringify(laterInvalidAgentLike)}`;

    expect(extractAgentOutputJson(wrapped)).toEqual(firstInvalidAgentLike);
  });

  it("prefers the first plain schema-invalid agent-like payload when later json-fenced and bare-fenced agent-like payloads are also invalid", () => {
    const firstInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "keep first plain invalid payload",
      reasoning: ["reason 1"],
      objections: ["objection 1"],
      risks: ["risk 1"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 1"],
    };
    const laterJsonFencedInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation in json fence",
      reasoning: ["reason 2"],
      objections: ["objection 2"],
      risks: ["risk 2"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 2"],
    };
    const laterBareFencedInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation in bare fence",
      reasoning: ["reason 3"],
      objections: ["objection 3"],
      risks: ["risk 3"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 3"],
    };
    const wrapped = `${JSON.stringify(firstInvalidAgentLike)}

\`\`\`json
${JSON.stringify(laterJsonFencedInvalidAgentLike)}
\`\`\`

\`\`\`
${JSON.stringify(laterBareFencedInvalidAgentLike)}
\`\`\``;

    expect(extractAgentOutputJson(wrapped)).toEqual(firstInvalidAgentLike);
  });

  it("prefers the first json-fenced schema-invalid agent-like payload when later plain and bare-fenced agent-like payloads are also invalid", () => {
    const firstInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "keep first json-fenced invalid payload",
      reasoning: ["reason 1"],
      objections: ["objection 1"],
      risks: ["risk 1"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 1"],
    };
    const laterPlainInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation in plain JSON",
      reasoning: ["reason 2"],
      objections: ["objection 2"],
      risks: ["risk 2"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 2"],
    };
    const laterBareFencedInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation in bare fence",
      reasoning: ["reason 3"],
      objections: ["objection 3"],
      risks: ["risk 3"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 3"],
    };
    const wrapped = `\`\`\`json
${JSON.stringify(firstInvalidAgentLike)}
\`\`\`

${JSON.stringify(laterPlainInvalidAgentLike)}

\`\`\`
${JSON.stringify(laterBareFencedInvalidAgentLike)}
\`\`\``;

    expect(extractAgentOutputJson(wrapped)).toEqual(firstInvalidAgentLike);
  });

  it("prefers the first bare-fenced schema-invalid agent-like payload when later plain and json-fenced agent-like payloads are also invalid", () => {
    const firstInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "keep first bare-fenced invalid payload",
      reasoning: ["reason 1"],
      objections: ["objection 1"],
      risks: ["risk 1"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 1"],
    };
    const laterPlainInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation in plain JSON",
      reasoning: ["reason 2"],
      objections: ["objection 2"],
      risks: ["risk 2"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 2"],
    };
    const laterJsonFencedInvalidAgentLike = {
      agent: "alpha",
      round: 2,
      stance: "missing recommendation in json fence",
      reasoning: ["reason 3"],
      objections: ["objection 3"],
      risks: ["risk 3"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question 3"],
    };
    const wrapped = `\`\`\`
${JSON.stringify(firstInvalidAgentLike)}
\`\`\`

${JSON.stringify(laterPlainInvalidAgentLike)}

\`\`\`json
${JSON.stringify(laterJsonFencedInvalidAgentLike)}
\`\`\``;

    expect(extractAgentOutputJson(wrapped)).toEqual(firstInvalidAgentLike);
  });

  it("prefers a later schema-valid payload over earlier irrelevant JSON", () => {
    const wrapped = `${JSON.stringify({ note: "ignore me" })}\n\n${sampleJson}`;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
  });

  it("prefers a later json-fenced schema-valid payload over earlier irrelevant JSON", () => {
    const wrapped = `${JSON.stringify({ note: "ignore me" })}\n\n\`\`\`json\n${sampleJson}\n\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
  });

  it("prefers a later bare-fenced schema-valid payload over earlier irrelevant JSON", () => {
    const wrapped = `${JSON.stringify({ note: "ignore me" })}

\`\`\`
${sampleJson}
\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
  });

  it("prefers a later schema-valid payload over earlier irrelevant fenced JSON", () => {
    const wrapped = `\`\`\`json\n${JSON.stringify({ note: "ignore fenced metadata" })}\n\`\`\`\n\n${sampleJson}`;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
  });

  it("prefers a later json-fenced schema-valid payload over earlier irrelevant json-fenced JSON", () => {
    const wrapped = `\`\`\`json\n${JSON.stringify({ note: "ignore fenced metadata" })}\n\`\`\`\n\n\`\`\`json\n${sampleJson}\n\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
  });

  it("prefers a later schema-valid payload over earlier irrelevant bare-fenced JSON", () => {
    const wrapped = `\`\`\`
${JSON.stringify({ note: "ignore bare fenced metadata" })}
\`\`\`

${sampleJson}`;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
  });

  it("prefers a later json-fenced schema-valid payload over earlier irrelevant bare-fenced JSON", () => {
    const wrapped = `\`\`\`
${JSON.stringify({ note: "ignore bare fenced metadata" })}
\`\`\`

\`\`\`json
${sampleJson}
\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
  });

  it("prefers a later bare-fenced schema-valid payload over earlier irrelevant bare-fenced JSON", () => {
    const wrapped = `\`\`\`
${JSON.stringify({ note: "ignore bare fenced metadata" })}
\`\`\`

\`\`\`
${sampleJson}
\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
  });

  it("prefers a later bare-fenced schema-valid payload over earlier irrelevant json-fenced JSON", () => {
    const wrapped = `\`\`\`json
${JSON.stringify({ note: "ignore fenced metadata" })}
\`\`\`

\`\`\`
${sampleJson}
\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
  });

  it("keeps the earliest plain schema-valid payload when earlier json-fenced metadata and later json-fenced plus bare-fenced valid payloads are also present", () => {
    const laterJsonFencedValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`json
${JSON.stringify({ note: "ignore fenced metadata" })}
\`\`\`

${sampleJson}

\`\`\`json
${JSON.stringify(laterJsonFencedValidPayload)}
\`\`\`

\`\`\`
${JSON.stringify(laterBareFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier json-fenced metadata and later plain plus bare-fenced valid payloads are also present", () => {
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`json
${JSON.stringify({ note: "ignore fenced metadata" })}
\`\`\`

\`\`\`json
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`
${JSON.stringify(laterBareFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("prefers a later schema-valid payload over earlier schema-invalid agent-like JSON", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `${JSON.stringify(invalidAgentLike)}\n\n${sampleJson}`;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later json-fenced schema-valid payload over earlier schema-invalid agent-like JSON", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `${JSON.stringify(invalidAgentLike)}\n\n\`\`\`json\n${sampleJson}\n\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later bare-fenced schema-valid payload over earlier schema-invalid agent-like JSON", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `${JSON.stringify(invalidAgentLike)}

\`\`\`
${sampleJson}
\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later schema-valid payload over earlier fenced schema-invalid agent-like JSON", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `\`\`\`json\n${JSON.stringify(invalidAgentLike)}\n\`\`\`\n\n${sampleJson}`;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later json-fenced schema-valid payload over earlier fenced schema-invalid agent-like JSON", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `\`\`\`json\n${JSON.stringify(invalidAgentLike)}\n\`\`\`\n\n\`\`\`json\n${sampleJson}\n\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later bare-fenced schema-valid payload over earlier fenced schema-invalid agent-like JSON", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `\`\`\`json\n${JSON.stringify(invalidAgentLike)}\n\`\`\`\n\n\`\`\`
${sampleJson}
\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("keeps the earliest plain schema-valid payload when earlier fenced schema-invalid agent-like JSON and later json-fenced plus bare-fenced valid payloads are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterJsonFencedPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`json
${JSON.stringify(earlierInvalidPayload)}
\`\`\`

${sampleJson}

\`\`\`json
${JSON.stringify(laterJsonFencedPayload)}
\`\`\`

\`\`\`
${JSON.stringify(laterBareFencedPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("prefers a later schema-valid payload over earlier bare-fenced schema-invalid agent-like JSON", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `\`\`\`
${JSON.stringify(invalidAgentLike)}
\`\`\`

${sampleJson}`;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later json-fenced schema-valid payload over earlier bare-fenced schema-invalid agent-like JSON", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `\`\`\`
${JSON.stringify(invalidAgentLike)}
\`\`\`

\`\`\`json
${sampleJson}
\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later bare-fenced schema-valid payload over earlier bare-fenced schema-invalid agent-like JSON", () => {
    const invalidAgentLike = {
      agent: "alpha",
      round: 2,
      recommendation: "missing required fields",
    };
    const wrapped = `\`\`\`
${JSON.stringify(invalidAgentLike)}
\`\`\`

\`\`\`
${sampleJson}
\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later schema-valid payload over earlier irrelevant JSON metadata", () => {
    const wrapped = `${JSON.stringify({ note: "ignore me" })}\n\n${sampleJson}`;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later schema-valid payload over earlier malformed fenced JSON", () => {
    const wrapped = `\`\`\`json\n{ "broken": \n\`\`\`\n\n${sampleJson}`;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later json-fenced schema-valid payload over earlier malformed fenced JSON", () => {
    const wrapped = `\`\`\`json\n{ "broken": \n\`\`\`\n\n\`\`\`json\n${sampleJson}\n\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later bare-fenced schema-valid payload over earlier malformed fenced JSON", () => {
    const wrapped = `\`\`\`json\n{ "broken": \n\`\`\`\n\n\`\`\`
${sampleJson}
\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("keeps the earliest plain schema-valid payload when earlier malformed fenced JSON and later json-fenced plus bare-fenced valid payloads are also present", () => {
    const laterJsonFencedPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`json
{ "broken": 
\`\`\`

${sampleJson}

\`\`\`json
${JSON.stringify(laterJsonFencedPayload)}
\`\`\`

\`\`\`
${JSON.stringify(laterBareFencedPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("prefers a later schema-valid payload over earlier malformed plain JSON", () => {
    const wrapped = `{ "broken": \n\n${sampleJson}`;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later json-fenced schema-valid payload over earlier malformed plain JSON", () => {
    const wrapped = `{ "broken": \n\n\`\`\`json\n${sampleJson}\n\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later bare-fenced schema-valid payload over earlier malformed plain JSON", () => {
    const wrapped = `{ "broken": \n\n\`\`\`
${sampleJson}
\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("keeps the earliest plain schema-valid payload when earlier malformed plain JSON and later json-fenced plus bare-fenced valid payloads are also present", () => {
    const laterJsonFencedPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `{ "broken": 

${sampleJson}

\`\`\`json
${JSON.stringify(laterJsonFencedPayload)}
\`\`\`

\`\`\`
${JSON.stringify(laterBareFencedPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier malformed plain JSON and later plain plus bare-fenced valid payloads are also present", () => {
    const laterPlainPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `{ "broken": 

\`\`\`json
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainPayload)}

\`\`\`
${JSON.stringify(laterBareFencedPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier malformed plain JSON and later plain plus json-fenced valid payloads are also present", () => {
    const laterPlainPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterJsonFencedPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `{ "broken": 

\`\`\`
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainPayload)}

\`\`\`json
${JSON.stringify(laterJsonFencedPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("prefers a later schema-valid payload over earlier malformed bare-fenced JSON", () => {
    const wrapped = `\`\`\`
{ "broken": 
\`\`\`

${sampleJson}`;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later json-fenced schema-valid payload over earlier malformed bare-fenced JSON", () => {
    const wrapped = `\`\`\`
{ "broken": 
\`\`\`

\`\`\`json
${sampleJson}
\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("prefers a later bare-fenced schema-valid payload over earlier malformed bare-fenced JSON", () => {
    const wrapped = `\`\`\`
{ "broken": 
\`\`\`

\`\`\`
${sampleJson}
\`\`\``;
    const output = parseAgentOutput(wrapped);
    expect(output.agent).toBe("alpha");
    expect(output.round).toBe(2);
    expect(output.confidence).toBe("high");
  });

  it("keeps the first schema-valid payload when stdout contains multiple valid agent outputs", () => {
    const laterPayload = {
      ...sampleObj,
      recommendation: "later recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${sampleJson}\n\n${JSON.stringify(laterPayload)}`;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earlier plain schema-valid payload when a later fenced payload is also valid", () => {
    const laterPayload = {
      ...sampleObj,
      recommendation: "later fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${sampleJson}\n\n\`\`\`json\n${JSON.stringify(laterPayload)}\n\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earlier fenced schema-valid payload when a later plain payload is also valid", () => {
    const laterPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `\`\`\`json\n${sampleJson}\n\`\`\`\n\n${JSON.stringify(laterPayload)}`;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the first schema-valid payload when stdout contains multiple valid fenced agent outputs", () => {
    const laterPayload = {
      ...sampleObj,
      recommendation: "later fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `\`\`\`json\n${sampleJson}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(laterPayload)}\n\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the first schema-valid payload when stdout contains multiple valid bare fenced agent outputs", () => {
    const laterPayload = {
      ...sampleObj,
      recommendation: "later bare fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `\`\`\`
${sampleJson}
\`\`\`

\`\`\`
${JSON.stringify(laterPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earlier plain schema-valid payload when a later bare fenced payload is also valid", () => {
    const laterPayload = {
      ...sampleObj,
      recommendation: "later bare fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${sampleJson}

\`\`\`
${JSON.stringify(laterPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earlier bare fenced schema-valid payload when a later plain payload is also valid", () => {
    const laterPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `\`\`\`
${sampleJson}
\`\`\`

${JSON.stringify(laterPayload)}`;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earlier json-fenced schema-valid payload when a later bare fenced payload is also valid", () => {
    const laterPayload = {
      ...sampleObj,
      recommendation: "later bare fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `\`\`\`json
${sampleJson}
\`\`\`

\`\`\`
${JSON.stringify(laterPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earlier bare fenced schema-valid payload when a later json-fenced payload is also valid", () => {
    const laterPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `\`\`\`
${sampleJson}
\`\`\`

\`\`\`json
${JSON.stringify(laterPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earlier plain schema-valid payload when later json-fenced and bare-fenced payloads are also valid", () => {
    const laterJsonFencedPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `${sampleJson}

\`\`\`json
${JSON.stringify(laterJsonFencedPayload)}
\`\`\`

\`\`\`
${JSON.stringify(laterBareFencedPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earlier json-fenced schema-valid payload when later plain and bare-fenced payloads are also valid", () => {
    const laterPlainPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`json
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainPayload)}

\`\`\`
${JSON.stringify(laterBareFencedPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earlier bare-fenced schema-valid payload when later plain and json-fenced payloads are also valid", () => {
    const laterPlainPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterJsonFencedPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainPayload)}

\`\`\`json
${JSON.stringify(laterJsonFencedPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest schema-valid payload when invalid agent-like payloads appear before and after it", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      stance: "later invalid payload should be ignored",
      reasoning: ["reason"],
      objections: ["objection"],
      risks: ["risk"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question"],
    };
    const wrapped = `${JSON.stringify(earlierInvalidPayload)}

${sampleJson}

\`\`\`
${JSON.stringify(laterInvalidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest plain schema-valid payload when an earlier invalid payload and later json-fenced valid payload are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${JSON.stringify(earlierInvalidPayload)}

${sampleJson}

\`\`\`json
${JSON.stringify(laterValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest plain schema-valid payload when an earlier invalid payload and later bare-fenced valid payload are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${JSON.stringify(earlierInvalidPayload)}

${sampleJson}

\`\`\`
${JSON.stringify(laterValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest plain schema-valid payload when an earlier invalid payload and later json-fenced plus bare-fenced valid payloads are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterJsonFencedValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `${JSON.stringify(earlierInvalidPayload)}

${sampleJson}

\`\`\`json
${JSON.stringify(laterJsonFencedValidPayload)}
\`\`\`

\`\`\`
${JSON.stringify(laterBareFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest plain schema-valid payload when earlier irrelevant metadata and a later json-fenced valid payload are also present", () => {
    const laterValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${JSON.stringify({ note: "ignore me" })}

${sampleJson}

\`\`\`json
${JSON.stringify(laterValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest plain schema-valid payload when earlier irrelevant metadata and a later bare-fenced valid payload are also present", () => {
    const laterValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${JSON.stringify({ note: "ignore me" })}

${sampleJson}

\`\`\`
${JSON.stringify(laterValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier irrelevant metadata and a later plain valid payload are also present", () => {
    const laterValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${JSON.stringify({ note: "ignore me" })}

\`\`\`json
${sampleJson}
\`\`\`

${JSON.stringify(laterValidPayload)}`;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier irrelevant metadata and a later bare-fenced valid payload are also present", () => {
    const laterValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${JSON.stringify({ note: "ignore me" })}

\`\`\`json
${sampleJson}
\`\`\`

\`\`\`
${JSON.stringify(laterValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier irrelevant metadata and a later plain valid payload are also present", () => {
    const laterValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${JSON.stringify({ note: "ignore me" })}

\`\`\`
${sampleJson}
\`\`\`

${JSON.stringify(laterValidPayload)}`;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier irrelevant metadata and a later json-fenced valid payload are also present", () => {
    const laterValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${JSON.stringify({ note: "ignore me" })}

\`\`\`
${sampleJson}
\`\`\`

\`\`\`json
${JSON.stringify(laterValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest json-fenced schema-valid payload when invalid agent-like payloads appear before and after it", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      stance: "later invalid payload should be ignored",
      reasoning: ["reason"],
      objections: ["objection"],
      risks: ["risk"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question"],
    };
    const wrapped = `${JSON.stringify(earlierInvalidPayload)}

\`\`\`json
${sampleJson}
\`\`\`

\`\`\`
${JSON.stringify(laterInvalidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest json-fenced schema-valid payload when an earlier invalid payload and later plain valid payload are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${JSON.stringify(earlierInvalidPayload)}

\`\`\`json
${sampleJson}
\`\`\`

${JSON.stringify(laterValidPayload)}`;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest json-fenced schema-valid payload when an earlier invalid payload and later bare-fenced valid payload are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${JSON.stringify(earlierInvalidPayload)}

 `.replace(
      /\n\n\u0000$/,
      `\n\n\`\`\`json\n${sampleJson}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(laterValidPayload)}\n\`\`\``,
    );

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest json-fenced schema-valid payload when an earlier invalid payload and later plain plus bare-fenced valid payloads are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `${JSON.stringify(earlierInvalidPayload)}

\`\`\`json
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`
${JSON.stringify(laterBareFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest bare-fenced schema-valid payload when invalid agent-like payloads appear before and after it", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      stance: "later invalid payload should be ignored",
      reasoning: ["reason"],
      objections: ["objection"],
      risks: ["risk"],
      changesFromPriorRound: [],
      confidence: "medium",
      openQuestions: ["question"],
    };
    const wrapped = `${JSON.stringify(earlierInvalidPayload)}



`.replace(
      /\n\n\n\n$/,
      `\n\n\`\`\`\n${sampleJson}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(laterInvalidPayload)}\n\`\`\``,
    );

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest bare-fenced schema-valid payload when an earlier invalid payload and later plain valid payload are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${JSON.stringify(earlierInvalidPayload)}


`.replace(
      /\n\n\n$/,
      `\n\n\`\`\`\n${sampleJson}\n\`\`\`\n\n${JSON.stringify(laterValidPayload)}`,
    );

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest bare-fenced schema-valid payload when an earlier invalid payload and later json-fenced valid payload are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const wrapped = `${JSON.stringify(earlierInvalidPayload)}


`.replace(
      /\n\n\n$/,
      `\n\n\`\`\`\n${sampleJson}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(laterValidPayload)}\n\`\`\``,
    );

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest bare-fenced schema-valid payload when an earlier invalid payload and later plain plus json-fenced valid payloads are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterJsonFencedValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `${JSON.stringify(earlierInvalidPayload)}


`.replace(
      /\n\n\n$/,
      `\n\n\`\`\`\n${sampleJson}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\``,
    );

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest plain schema-valid payload when earlier irrelevant metadata and later json-fenced plus bare-fenced valid payloads are also present", () => {
    const laterJsonFencedValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `${JSON.stringify({ note: "ignore me" })}

${sampleJson}

\`\`\`json
${JSON.stringify(laterJsonFencedValidPayload)}
\`\`\`

\`\`\`
${JSON.stringify(laterBareFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier irrelevant metadata and later plain plus bare-fenced valid payloads are also present", () => {
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `${JSON.stringify({ note: "ignore me" })}

\`\`\`json
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`
${JSON.stringify(laterBareFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest plain schema-valid payload when earlier bare-fenced irrelevant metadata and later json-fenced plus bare-fenced valid payloads are also present", () => {
    const laterJsonFencedValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`
${JSON.stringify({ note: "ignore bare fenced metadata" })}
\`\`\`

${sampleJson}

\`\`\`json
${JSON.stringify(laterJsonFencedValidPayload)}
\`\`\`

\`\`\`
${JSON.stringify(laterBareFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier bare-fenced irrelevant metadata and later plain plus bare-fenced valid payloads are also present", () => {
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`
${JSON.stringify({ note: "ignore bare fenced metadata" })}
\`\`\`

\`\`\`json
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`
${JSON.stringify(laterBareFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier bare-fenced irrelevant metadata and later plain plus json-fenced valid payloads are also present", () => {
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterJsonFencedValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`
${JSON.stringify({ note: "ignore bare fenced metadata" })}
\`\`\`

\`\`\`
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`json
${JSON.stringify(laterJsonFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier json-fenced irrelevant metadata and later plain plus json-fenced valid payloads are also present", () => {
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterJsonFencedValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`json
${JSON.stringify({ note: "ignore fenced metadata" })}
\`\`\`

\`\`\`
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`json
${JSON.stringify(laterJsonFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier irrelevant metadata and later plain plus json-fenced valid payloads are also present", () => {
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterJsonFencedValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `${JSON.stringify({ note: "ignore me" })}

\`\`\`
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`json
${JSON.stringify(laterJsonFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier json-fenced schema-invalid agent-like JSON and later plain plus bare-fenced valid payloads are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`json
${JSON.stringify(earlierInvalidPayload)}
\`\`\`

\`\`\`json
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`
${JSON.stringify(laterBareFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier json-fenced schema-invalid agent-like JSON and later plain plus json-fenced valid payloads are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterJsonFencedValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`json
${JSON.stringify(earlierInvalidPayload)}
\`\`\`

\`\`\`
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`json
${JSON.stringify(laterJsonFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest plain schema-valid payload when earlier bare-fenced schema-invalid agent-like JSON and later json-fenced plus bare-fenced valid payloads are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterJsonFencedValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`
${JSON.stringify(earlierInvalidPayload)}
\`\`\`

${sampleJson}

\`\`\`json
${JSON.stringify(laterJsonFencedValidPayload)}
\`\`\`

\`\`\`
${JSON.stringify(laterBareFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier bare-fenced schema-invalid agent-like JSON and later plain plus bare-fenced valid payloads are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`
${JSON.stringify(earlierInvalidPayload)}
\`\`\`

\`\`\`json
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`
${JSON.stringify(laterBareFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier bare-fenced schema-invalid agent-like JSON and later plain plus json-fenced valid payloads are also present", () => {
    const earlierInvalidPayload = {
      agent: sampleObj.agent,
      round: sampleObj.round,
      recommendation: "missing required fields",
    };
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterJsonFencedValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`
${JSON.stringify(earlierInvalidPayload)}
\`\`\`

\`\`\`
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`json
${JSON.stringify(laterJsonFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier malformed fenced JSON and later plain plus bare-fenced valid payloads are also present", () => {
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`json
{ "broken": 
\`\`\`

\`\`\`json
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`
${JSON.stringify(laterBareFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier malformed fenced JSON and later plain plus json-fenced valid payloads are also present", () => {
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterJsonFencedValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`json
{ "broken": 
\`\`\`

\`\`\`
${sampleJson}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`json
${JSON.stringify(laterJsonFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest plain schema-valid payload when earlier malformed bare-fenced JSON and later json-fenced plus bare-fenced valid payloads are also present", () => {
    const laterJsonFencedValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`
{ "broken": 
\`\`\`

${sampleJson}

\`\`\`json
${JSON.stringify(laterJsonFencedValidPayload)}
\`\`\`

\`\`\`
${JSON.stringify(laterBareFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier malformed bare-fenced JSON and later plain plus bare-fenced valid payloads are also present", () => {
    const validPayload = {
      ...sampleObj,
      round: sampleObj.round,
    };
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterBareFencedValidPayload = {
      ...sampleObj,
      recommendation: "later bare-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`
{ "broken": 
\`\`\`

\`\`\`json
${JSON.stringify(validPayload)}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`
${JSON.stringify(laterBareFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier malformed bare-fenced JSON and later plain plus json-fenced valid payloads are also present", () => {
    const validPayload = {
      ...sampleObj,
      round: sampleObj.round,
    };
    const laterPlainValidPayload = {
      ...sampleObj,
      recommendation: "later plain recommendation should be ignored",
      round: sampleObj.round + 1,
    };
    const laterJsonFencedValidPayload = {
      ...sampleObj,
      recommendation: "later json-fenced recommendation should be ignored",
      round: sampleObj.round + 2,
    };
    const wrapped = `\`\`\`
{ "broken": 
\`\`\`

\`\`\`
${JSON.stringify(validPayload)}
\`\`\`

${JSON.stringify(laterPlainValidPayload)}

\`\`\`json
${JSON.stringify(laterJsonFencedValidPayload)}
\`\`\``;

    const output = parseAgentOutput(wrapped);

    expect(output.agent).toBe(sampleObj.agent);
    expect(output.round).toBe(sampleObj.round);
    expect(output.recommendation).toBe(sampleObj.recommendation);
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

describe("ClaudeCliAdapter.dispatch", () => {
  const execaMock = vi.mocked(execa);

  function makeAgent(
    overrides: Partial<AgentDefinition> = {},
  ): AgentDefinition {
    return {
      name: "alpha",
      description: "alpha agent",
      persona: "You are the alpha agent focused on rigorous analysis.",
      prompt: "Analyze the brief as alpha.",
      backend: "claude",
      ...overrides,
    };
  }

  function mockOkResponse(stdout = '{"ok":true}"') {
    execaMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout,
      stderr: "",
      timedOut: false,
    } as never);
  }

  function getCallArgs() {
    expect(execaMock).toHaveBeenCalledTimes(1);
    const call = execaMock.mock.calls[0];
    const [cmd, args, opts] = call as unknown as [
      string,
      string[],
      { input: string; timeout: number; reject: boolean },
    ];
    return { cmd, args, opts };
  }

  it("invokes `claude --print` with --system-prompt composed from persona + prompt", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch("round brief", makeAgent(), { timeoutMs: 5000 });

    const { cmd, args } = getCallArgs();
    expect(cmd).toBe("claude");
    expect(args).toContain("--print");
    expect(args).toContain("--system-prompt");

    const systemPromptIdx = args.indexOf("--system-prompt");
    const systemPromptValue = args[systemPromptIdx + 1];
    expect(systemPromptValue).toContain(
      "You are the alpha agent focused on rigorous analysis.",
    );
    expect(systemPromptValue).toContain("Analyze the brief as alpha.");
  });

  it("produces distinct system prompts per agent so agents are differentiated", async () => {
    execaMock.mockReset();
    mockOkResponse();
    mockOkResponse();

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        name: "product-manager",
        persona: "You are a rigorous product manager.",
        prompt: "Focus on user value and sequencing.",
      }),
      { timeoutMs: 5000 },
    );
    await adapter.dispatch(
      "brief",
      makeAgent({
        name: "principal-engineer",
        persona: "You are a principal engineer.",
        prompt: "Focus on system design and failure modes.",
      }),
      { timeoutMs: 5000 },
    );

    const calls = execaMock.mock.calls as unknown as [string, string[]][];
    expect(calls).toHaveLength(2);
    const [, firstArgs] = calls[0];
    const [, secondArgs] = calls[1];
    const firstSystem = firstArgs[firstArgs.indexOf("--system-prompt") + 1];
    const secondSystem = secondArgs[secondArgs.indexOf("--system-prompt") + 1];
    expect(firstSystem).toContain("product manager");
    expect(secondSystem).toContain("principal engineer");
    expect(firstSystem).not.toEqual(secondSystem);
  });

  it("pipes the round brief via stdin and forwards the timeout", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch("the full round brief", makeAgent(), {
      timeoutMs: 12345,
    });

    const { opts } = getCallArgs();
    expect(opts.input).toBe("the full round brief");
    expect(opts.timeout).toBe(12345);
    expect(opts.reject).toBe(false);
  });

  it("resolves file-based prompt refs before composing the system prompt", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const fixtureFile = fileURLToPath(
      new URL("../fixtures/agent-prompt.md", import.meta.url),
    );

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        persona: "You are the file-backed agent.",
        prompt: { file: fixtureFile },
      }),
      { timeoutMs: 5000 },
    );

    const { args } = getCallArgs();
    const systemPromptValue = args[args.indexOf("--system-prompt") + 1];
    expect(systemPromptValue).toContain("You are the file-backed agent.");
    expect(systemPromptValue).toContain(
      "Prompt body loaded from disk for testing.",
    );
  });

  it("omits --system-prompt when persona and prompt trim to empty content", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        persona: "   ",
        prompt: "\n  \t  ",
      }),
      { timeoutMs: 5000 },
    );

    const { args } = getCallArgs();
    expect(args).not.toContain("--system-prompt");
  });

  it("keeps a trimmed prompt-only system prompt when persona is blank", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        persona: "  \n\t  ",
        prompt: "\n  Focus only on implementation details.  \n",
      }),
      { timeoutMs: 5000 },
    );

    const { args } = getCallArgs();
    const systemPromptValue = args[args.indexOf("--system-prompt") + 1];
    expect(systemPromptValue).toBe("Focus only on implementation details.");
  });

  it("keeps a trimmed persona-only system prompt when prompt content is blank", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        persona: "\n  You are the escalation-only reviewer.  \t",
        prompt: "  \n\t  ",
      }),
      { timeoutMs: 5000 },
    );

    const { args } = getCallArgs();
    const systemPromptValue = args[args.indexOf("--system-prompt") + 1];
    expect(systemPromptValue).toBe("You are the escalation-only reviewer.");
  });

  it("trims away blank file-backed prompt content and keeps the persona-only system prompt", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const blankPromptFile = fileURLToPath(
      new URL("../fixtures/blank-agent-prompt.md", import.meta.url),
    );

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        persona: "  You are the file-backed escalation reviewer.\n",
        prompt: { file: blankPromptFile },
      }),
      { timeoutMs: 5000 },
    );

    const { args } = getCallArgs();
    const systemPromptValue = args[args.indexOf("--system-prompt") + 1];
    expect(systemPromptValue).toBe(
      "You are the file-backed escalation reviewer.",
    );
  });

  it("keeps a trimmed file-backed prompt-only system prompt when persona is blank", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const fixtureFile = fileURLToPath(
      new URL("../fixtures/agent-prompt.md", import.meta.url),
    );

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        persona: "  \n\t  ",
        prompt: { file: fixtureFile },
      }),
      { timeoutMs: 5000 },
    );

    const { args } = getCallArgs();
    const systemPromptValue = args[args.indexOf("--system-prompt") + 1];
    expect(systemPromptValue).toBe("Prompt body loaded from disk for testing.");
  });

  it("omits --system-prompt when a file-backed prompt also trims to empty", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const blankPromptFile = fileURLToPath(
      new URL("../fixtures/blank-agent-prompt.md", import.meta.url),
    );

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch(
      "brief",
      makeAgent({
        persona: " \n\t  ",
        prompt: { file: blankPromptFile },
      }),
      { timeoutMs: 5000 },
    );

    const { args } = getCallArgs();
    expect(args).not.toContain("--system-prompt");
  });

  it("fails before invoking claude when a file-based prompt ref is missing", async () => {
    execaMock.mockReset();

    const adapter = new ClaudeCliAdapter();
    const missingPromptFile = fileURLToPath(
      new URL("../fixtures/does-not-exist.md", import.meta.url),
    );

    await expect(
      adapter.dispatch(
        "brief",
        makeAgent({
          prompt: { file: missingPromptFile },
        }),
        { timeoutMs: 5000 },
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
      path: missingPromptFile,
    });
    expect(execaMock).not.toHaveBeenCalled();
  });

  it("returns failed subprocess metadata when claude exits non-zero", async () => {
    execaMock.mockReset();
    execaMock.mockResolvedValueOnce({
      exitCode: 2,
      stdout: "partial output",
      stderr: "backend failed",
      timedOut: true,
    } as never);

    const adapter = new ClaudeCliAdapter();
    const response = await adapter.dispatch("brief", makeAgent(), {
      timeoutMs: 5000,
    });

    expect(response.ok).toBe(false);
    expect(response.exitCode).toBe(2);
    expect(response.stdout).toBe("partial output");
    expect(response.stderr).toBe("backend failed");
    expect(response.timedOut).toBe(true);
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("normalizes missing subprocess exit codes to 1", async () => {
    execaMock.mockReset();
    execaMock.mockResolvedValueOnce({
      exitCode: undefined,
      stdout: "",
      stderr: "terminated by signal",
      timedOut: false,
    } as never);

    const adapter = new ClaudeCliAdapter();
    const response = await adapter.dispatch("brief", makeAgent(), {
      timeoutMs: 5000,
    });

    expect(response.ok).toBe(false);
    expect(response.exitCode).toBe(1);
    expect(response.stderr).toBe("terminated by signal");
    expect(response.timedOut).toBe(false);
  });

  it("propagates subprocess spawn failures when claude cannot be started", async () => {
    execaMock.mockReset();
    const spawnError = Object.assign(new Error("spawn claude ENOENT"), {
      code: "ENOENT",
      syscall: "spawn claude",
    });
    execaMock.mockRejectedValueOnce(spawnError as never);

    const adapter = new ClaudeCliAdapter();

    await expect(
      adapter.dispatch("brief", makeAgent(), {
        timeoutMs: 5000,
      }),
    ).rejects.toMatchObject({
      message: "spawn claude ENOENT",
      code: "ENOENT",
      syscall: "spawn claude",
    });
  });

  it("forwards agent.model as --model when set", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch("brief", makeAgent({ model: "claude-sonnet-4-5" }), {
      timeoutMs: 5000,
    });

    const { args } = getCallArgs();
    const flagIndex = args.indexOf("--model");
    expect(flagIndex).toBeGreaterThan(-1);
    expect(args[flagIndex + 1]).toBe("claude-sonnet-4-5");
  });

  it("omits --model when agent.model is not set", async () => {
    execaMock.mockReset();
    mockOkResponse();

    const adapter = new ClaudeCliAdapter();
    await adapter.dispatch("brief", makeAgent(), { timeoutMs: 5000 });

    const { args } = getCallArgs();
    expect(args).not.toContain("--model");
  });
});
