import { describe, expect, it } from "vitest";
import { buildOrchestratorResolutionPrompt } from "../../../src/lib/index.js";
import type { RoundPacket } from "../../../src/schemas/index.js";

const fullPacket: RoundPacket = {
  round: 1,
  agents: ["alpha", "beta"],
  summaries: [
    {
      agent: "alpha",
      stance: "lean toward option B",
      recommendation: "Pick option B and ship a thin slice",
      objections: ["Risk of scope creep"],
      risks: ["Deadline pressure"],
      confidence: "high",
      openQuestions: ["Which team owns deployment?"],
    },
    {
      agent: "beta",
      stance: "cautious about timeline",
      recommendation: "phase rollout",
      objections: ["Team capacity unclear"],
      risks: ["Deadline pressure"],
      confidence: "medium",
      openQuestions: ["Should we pre-warm the cache?"],
    },
  ],
  keyObjections: ["Risk of scope creep", "Team capacity unclear"],
  sharedRisks: ["Deadline pressure"],
  openQuestions: [
    "Which team owns deployment?",
    "Should we pre-warm the cache?",
  ],
  questionResolutions: [
    {
      question: "Which model variant?",
      status: "consensus",
      answer: "Use the default model.",
      basis: "Both agents agreed in round 0.",
      confidence: "high",
      askedBy: ["alpha"],
      supportingAgents: ["alpha", "beta"],
      supportingReasoning: ["Cheaper and proven"],
      relatedObjections: [],
      relatedRisks: [],
      blockingScore: 0,
    },
  ],
  questionResolutionLimit: 3,
  deferredQuestions: ["Long-term ownership story"],
};

describe("buildOrchestratorResolutionPrompt", () => {
  it("includes the orchestrator role and the upcoming round number in the header", () => {
    const out = buildOrchestratorResolutionPrompt({
      packet: fullPacket,
      goal: "ship the slice",
      decision: "pick option A or B",
      nextRound: 2,
    });
    expect(out).toContain("# Orchestrator Resolution Pass");
    expect(out).toMatch(/Round\s*2/);
    expect(out).toContain("round 1");
  });

  it("includes the goal and decision target", () => {
    const out = buildOrchestratorResolutionPrompt({
      packet: fullPacket,
      goal: "ship the slice",
      decision: "pick option A or B",
      nextRound: 2,
    });
    expect(out).toContain("Goal: ship the slice");
    expect(out).toContain("Decision target: pick option A or B");
  });

  it("uses n/a when goal or decision target are null", () => {
    const out = buildOrchestratorResolutionPrompt({
      packet: fullPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });
    expect(out).toContain("Goal: n/a");
    expect(out).toContain("Decision target: n/a");
  });

  it("lists open questions, key objections and shared risks from the packet", () => {
    const out = buildOrchestratorResolutionPrompt({
      packet: fullPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });
    expect(out).toContain("Which team owns deployment?");
    expect(out).toContain("Should we pre-warm the cache?");
    expect(out).toContain("Risk of scope creep");
    expect(out).toContain("Team capacity unclear");
    expect(out).toContain("Deadline pressure");
  });

  it("lists prior resolutions and previously deferred questions", () => {
    const out = buildOrchestratorResolutionPrompt({
      packet: fullPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });
    expect(out).toContain("Which model variant?");
    expect(out).toContain("Use the default model.");
    expect(out).toContain("Long-term ownership story");
  });

  it("renders agent stance summaries with confidence and recommendation", () => {
    const out = buildOrchestratorResolutionPrompt({
      packet: fullPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
    expect(out).toContain("lean toward option B");
    expect(out).toContain("Pick option B and ship a thin slice");
  });

  it("includes the orchestrator output schema contract (not the agent contract)", () => {
    const out = buildOrchestratorResolutionPrompt({
      packet: fullPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });
    expect(out).toContain("## Output contract");
    expect(out).toContain("round: number");
    expect(out).toContain("directive: string");
    expect(out).toContain("questionResolutions");
    expect(out).toContain("questionResolutionLimit: number");
    expect(out).toContain("deferredQuestions: string[]");
    expect(out).toMatch(/confidence:\s*"low"\s*\|\s*"medium"\s*\|\s*"high"/);
    expect(out).toContain("blockingScore: number");
    // Must not leak the agent-output contract
    expect(out).not.toContain("changesFromPriorRound");
    expect(out).not.toContain("recommendation: string\n");
  });

  it("instructs the orchestrator to resolve only evidence-backed questions and defer the rest", () => {
    const out = buildOrchestratorResolutionPrompt({
      packet: fullPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });
    expect(out).toMatch(/evidence/i);
    expect(out).toMatch(/defer/i);
    expect(out).toMatch(/do not speculate/i);
  });

  it("clearly separates source packet context from requested orchestrator output", () => {
    const out = buildOrchestratorResolutionPrompt({
      packet: fullPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });
    const sourceIdx = out.indexOf("## Source packet");
    const outputIdx = out.indexOf("## Output contract");
    const instructionsIdx = out.indexOf("## Instructions");
    expect(sourceIdx).toBeGreaterThan(0);
    expect(instructionsIdx).toBeGreaterThan(sourceIdx);
    expect(outputIdx).toBeGreaterThan(instructionsIdx);
  });

  it("emits the JSON-only no-prose instruction", () => {
    const out = buildOrchestratorResolutionPrompt({
      packet: fullPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });
    expect(out).toMatch(/Return ONLY the JSON object/);
  });

  it("omits empty source sub-sections when the packet has no content for them", () => {
    const emptyPacket: RoundPacket = {
      round: 1,
      agents: [],
      summaries: [],
      keyObjections: [],
      sharedRisks: [],
      openQuestions: [],
      questionResolutions: [],
      questionResolutionLimit: 3,
      deferredQuestions: [],
    };
    const out = buildOrchestratorResolutionPrompt({
      packet: emptyPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });
    expect(out).not.toContain("### Stance summary");
    expect(out).not.toContain("### Open questions");
    expect(out).not.toContain("### Key objections");
    expect(out).not.toContain("### Shared risks");
    expect(out).not.toContain("### Prior resolutions");
    expect(out).not.toContain("### Previously deferred questions");
    expect(out).toContain("## Source packet");
    expect(out).toContain("## Output contract");
  });

  it("ends with a single trailing newline", () => {
    const out = buildOrchestratorResolutionPrompt({
      packet: fullPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
