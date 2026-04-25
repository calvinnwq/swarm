import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { AgentOutput, RunManifest } from "../../../src/schemas/index.js";
import type { AgentResponse } from "../../../src/backends/index.js";
import type {
  AgentResult,
  RoundResult,
} from "../../../src/lib/round-runner.js";
import type { SynthesisResult } from "../../../src/lib/synthesis.js";
import {
  slugify,
  buildRunDirName,
  renderAgentMarkdown,
  createArtifactWriter,
} from "../../../src/lib/artifact-writer.js";

function makeManifest(runDir: string): RunManifest {
  return {
    runId: "00000000-0000-0000-0000-000000000001",
    status: "running",
    topic: "Should we adopt TypeScript?",
    rounds: 2,
    backend: "claude",
    preset: null,
    agents: ["product-manager", "principal-engineer"],
    resolveMode: "orchestrator",
    startedAt: "2026-04-19T10:00:00.000Z",
    runDir,
  };
}

function makeAgentOutput(agent: string, round: number): AgentOutput {
  return {
    agent,
    round,
    stance: "approve",
    recommendation: `${agent} recommends adoption`,
    reasoning: ["Type safety", "Better DX"],
    objections: ["Migration cost"],
    risks: ["Learning curve"],
    changesFromPriorRound: round > 1 ? ["Revised estimate"] : [],
    confidence: "high",
    openQuestions: ["Timeline?"],
  };
}

function makeRawResponse(output: AgentOutput): AgentResponse {
  return {
    ok: true,
    exitCode: 0,
    stdout: JSON.stringify(output),
    stderr: "",
    timedOut: false,
    durationMs: 5000,
  };
}

function makeAgentResult(agent: string, round: number): AgentResult {
  const output = makeAgentOutput(agent, round);
  return {
    agent,
    ok: true,
    output,
    raw: makeRawResponse(output),
    error: null,
  };
}

function makeFailedAgentResult(agent: string): AgentResult {
  return {
    agent,
    ok: false,
    output: null,
    raw: {
      ok: false,
      exitCode: 1,
      stdout: "partial output",
      stderr: "error occurred",
      timedOut: false,
      durationMs: 1200,
    },
    error: "Agent exited with code 1",
  };
}

function makeRoundResult(round: number, agents: string[]): RoundResult {
  const agentResults = agents.map((a) => makeAgentResult(a, round));
  return {
    round,
    agentResults,
    packet: {
      round,
      agents,
      summaries: agentResults.map((r) => ({
        agent: r.agent,
        stance: r.output!.stance,
        recommendation: r.output!.recommendation,
        objections: r.output!.objections,
        risks: r.output!.risks,
        confidence: r.output!.confidence,
        openQuestions: r.output!.openQuestions,
      })),
      keyObjections: ["Migration cost"],
      sharedRisks: [],
      openQuestions: ["Timeline?"],
      questionResolutions: [],
      questionResolutionLimit: 0,
      deferredQuestions: [],
    },
  };
}

function makeSynthesis(): SynthesisResult {
  return {
    json: {
      topic: "Should we adopt TypeScript?",
      rounds: 2,
      agents: ["product-manager", "principal-engineer"],
      resolveMode: "orchestrator",
      consensus: true,
      stanceTally: [
        {
          stance: "approve",
          agents: ["product-manager", "principal-engineer"],
          count: 2,
        },
      ],
      topRecommendation: "product-manager recommends adoption",
      topRecommendationBasis: ["Type safety", "Better DX"],
      sharedRisks: [],
      keyObjections: ["Migration cost"],
      openQuestions: ["Timeline?"],
      deferredQuestions: [],
      overallConfidence: "high",
      roundCount: 2,
      agentCount: 2,
    },
    markdown: "# Synthesis: Should we adopt TypeScript?\n\n...",
  };
}

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `artifact-writer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("slugify", () => {
  it("lowercases and replaces non-alphanumeric with hyphens", () => {
    expect(slugify("Should We Adopt TypeScript?")).toBe(
      "should-we-adopt-typescript",
    );
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("--hello world--")).toBe("hello-world");
  });

  it("collapses consecutive separators", () => {
    expect(slugify("a   b...c")).toBe("a-b-c");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});

describe("buildRunDirName", () => {
  it("formats as YYYYMMDD-HHMMSS-slug", () => {
    const date = new Date("2026-04-19T10:05:03.000Z");
    const result = buildRunDirName(date, "My Topic");
    expect(result).toBe("20260419-100503-my-topic");
  });

  it("zero-pads single-digit months and days", () => {
    const date = new Date("2026-01-05T08:01:02.000Z");
    const result = buildRunDirName(date, "test");
    expect(result).toBe("20260105-080102-test");
  });
});

describe("renderAgentMarkdown", () => {
  it("renders successful agent output with all sections", () => {
    const result = makeAgentResult("product-manager", 1);
    const md = (renderAgentMarkdown as (...args: unknown[]) => string)(
      result,
      1,
      "codex-cli",
    );

    expect(md).toContain("Agent: product-manager");
    expect(md).toContain("Round: 1");
    expect(md).toContain("Status: ok");
    expect(md).toContain("Exit code: 0");
    expect(md).toContain("Timed out: false");
    expect(md).toContain("Duration seconds: 5.0");
    expect(md).toContain("Wrapper: codex-cli");
    expect(md).toContain("## Stance\n\napprove");
    expect(md).toContain(
      "## Recommendation\n\nproduct-manager recommends adoption",
    );
    expect(md).toContain("## Reasoning\n\n- Type safety\n- Better DX");
    expect(md).toContain("## Objections\n\n- Migration cost");
    expect(md).toContain("## Risks\n\n- Learning curve");
    expect(md).toContain("## Confidence\n\nhigh");
    expect(md).toContain("## Open Questions\n\n- Timeline?");
    expect(md).toContain("## Raw Output");
  });

  it("renders failed agent with error section", () => {
    const result = makeFailedAgentResult("principal-engineer");
    const md = renderAgentMarkdown(result, 1);

    expect(md).toContain("Status: failed");
    expect(md).toContain("Exit code: 1");
    expect(md).toContain("## Error\n\nAgent exited with code 1");
    expect(md).toContain("## Raw Output");
    expect(md).toContain("partial output");
  });

  it("shows 'None.' for empty array sections", () => {
    const result = makeAgentResult("product-manager", 1);
    result.output!.objections = [];
    result.output!.risks = [];
    result.output!.changesFromPriorRound = [];
    result.output!.openQuestions = [];
    const md = renderAgentMarkdown(result, 1);

    expect(md).toContain("## Objections\n\nNone.");
    expect(md).toContain("## Risks\n\nNone.");
    expect(md).toContain("## Changes From Prior Round\n\nNone.");
    expect(md).toContain("## Open Questions\n\nNone.");
  });

  it("renders changesFromPriorRound for round > 1", () => {
    const result = makeAgentResult("product-manager", 2);
    const md = renderAgentMarkdown(result, 2);

    expect(md).toContain("## Changes From Prior Round\n\n- Revised estimate");
  });

  it("emits Harness and Model header lines when runtime is stamped", () => {
    const result = makeAgentResult("product-manager", 1);
    result.runtime = {
      agentName: "product-manager",
      harness: "codex",
      model: "gpt-5",
      source: { harness: "agent.harness", model: "agent.model" },
    };
    const md = renderAgentMarkdown(result, 1, "codex-cli");

    expect(md).toContain("Harness: codex");
    expect(md).toContain("Model: gpt-5");
  });

  it("falls back to harness-default Model line when model is null", () => {
    const result = makeAgentResult("principal-engineer", 1);
    result.runtime = {
      agentName: "principal-engineer",
      harness: "claude",
      model: null,
      source: { harness: "agent.backend", model: "harness-default" },
    };
    const md = renderAgentMarkdown(result, 1);

    expect(md).toContain("Harness: claude");
    expect(md).toContain("Model: harness-default");
  });

  it("omits Harness and Model lines when no runtime is stamped", () => {
    const result = makeAgentResult("product-manager", 1);
    const md = renderAgentMarkdown(result, 1);

    expect(md).not.toContain("Harness:");
    expect(md).not.toContain("Model:");
  });

  it("derives Wrapper from runtime.harness when stamped, overriding the run-level wrapperName", () => {
    const result = makeAgentResult("principal-engineer", 1);
    result.runtime = {
      agentName: "principal-engineer",
      harness: "codex",
      model: "gpt-5",
      source: { harness: "agent.harness", model: "agent.model" },
    };
    const md = renderAgentMarkdown(result, 1, "claude-cli");

    expect(md).toContain("Wrapper: codex-cli");
    expect(md).toContain("Harness: codex");
    expect(md).toContain("Model: gpt-5");
  });
});

describe("ArtifactWriter", () => {
  describe("init", () => {
    it("creates run directory with manifest.json and seed-brief.md", () => {
      const runDir = join(testDir, "run-1");
      const manifest = makeManifest(runDir);
      const writer = createArtifactWriter({
        baseDir: testDir,
        manifest,
        seedBrief: "# Seed Brief\n\nTopic: TypeScript",
      });

      writer.init();

      expect(existsSync(runDir)).toBe(true);
      const manifestJson = JSON.parse(
        readFileSync(join(runDir, "manifest.json"), "utf-8"),
      );
      expect(manifestJson.topic).toBe("Should we adopt TypeScript?");
      expect(manifestJson.rounds).toBe(2);
      expect(manifestJson.agents).toEqual([
        "product-manager",
        "principal-engineer",
      ]);
      expect(manifestJson.runId).toBe("00000000-0000-0000-0000-000000000001");
      expect(manifestJson.status).toBe("running");

      const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
      expect(seedBrief).toBe("# Seed Brief\n\nTopic: TypeScript");
    });
  });

  describe("writeRound", () => {
    it("creates round directory with brief and agent markdown files", () => {
      const runDir = join(testDir, "run-2");
      const manifest = makeManifest(runDir);
      const writer = createArtifactWriter({
        baseDir: testDir,
        manifest,
        seedBrief: "seed",
        wrapperName: "codex-cli",
      });
      writer.init();

      const roundResult = makeRoundResult(1, [
        "product-manager",
        "principal-engineer",
      ]);
      writer.writeRound(roundResult, "# Round 1 Brief");

      const roundDir = join(runDir, "round-01");
      expect(existsSync(roundDir)).toBe(true);

      const brief = readFileSync(join(roundDir, "brief.md"), "utf-8");
      expect(brief).toBe("# Round 1 Brief");

      const agentsDir = join(roundDir, "agents");
      expect(existsSync(join(agentsDir, "product-manager.md"))).toBe(true);
      expect(existsSync(join(agentsDir, "principal-engineer.md"))).toBe(true);

      const pmMd = readFileSync(join(agentsDir, "product-manager.md"), "utf-8");
      expect(pmMd).toContain("Agent: product-manager");
      expect(pmMd).toContain("Wrapper: codex-cli");
      expect(pmMd).toContain("## Stance");
    });

    it("zero-pads round numbers in directory name", () => {
      const runDir = join(testDir, "run-pad");
      const manifest = makeManifest(runDir);
      const writer = createArtifactWriter({
        baseDir: testDir,
        manifest,
        seedBrief: "seed",
      });
      writer.init();

      const roundResult = makeRoundResult(1, ["product-manager"]);
      writer.writeRound(roundResult, "brief");

      expect(existsSync(join(runDir, "round-01"))).toBe(true);
    });

    it("writes failed agents alongside successful ones", () => {
      const runDir = join(testDir, "run-mixed");
      const manifest = makeManifest(runDir);
      const writer = createArtifactWriter({
        baseDir: testDir,
        manifest,
        seedBrief: "seed",
      });
      writer.init();

      const ok = makeAgentResult("product-manager", 1);
      const fail = makeFailedAgentResult("principal-engineer");
      const roundResult: RoundResult = {
        round: 1,
        agentResults: [ok, fail],
        packet: makeRoundResult(1, ["product-manager"]).packet,
      };

      writer.writeRound(roundResult, "brief");

      const agentsDir = join(runDir, "round-01", "agents");
      const pmMd = readFileSync(join(agentsDir, "product-manager.md"), "utf-8");
      expect(pmMd).toContain("Status: ok");

      const peMd = readFileSync(
        join(agentsDir, "principal-engineer.md"),
        "utf-8",
      );
      expect(peMd).toContain("Status: failed");
      expect(peMd).toContain("## Error");
    });
  });

  describe("writeSynthesis", () => {
    it("writes synthesis.json and synthesis.md", () => {
      const runDir = join(testDir, "run-synth");
      const manifest = makeManifest(runDir);
      const writer = createArtifactWriter({
        baseDir: testDir,
        manifest,
        seedBrief: "seed",
      });
      writer.init();

      const synthesis = makeSynthesis();
      writer.writeSynthesis(synthesis);

      const synthJson = JSON.parse(
        readFileSync(join(runDir, "synthesis.json"), "utf-8"),
      );
      expect(synthJson.topic).toBe("Should we adopt TypeScript?");
      expect(synthJson.consensus).toBe(true);
      expect(synthJson.overallConfidence).toBe("high");

      const synthMd = readFileSync(join(runDir, "synthesis.md"), "utf-8");
      expect(synthMd).toContain("# Synthesis: Should we adopt TypeScript?");
    });
  });

  describe("finalize", () => {
    it("updates manifest.json with finishedAt timestamp", () => {
      const runDir = join(testDir, "run-final");
      const manifest = makeManifest(runDir);
      const writer = createArtifactWriter({
        baseDir: testDir,
        manifest,
        seedBrief: "seed",
      });
      writer.init();

      writer.finalize("2026-04-19T10:05:00.000Z", "done");

      const updated = JSON.parse(
        readFileSync(join(runDir, "manifest.json"), "utf-8"),
      );
      expect(updated.finishedAt).toBe("2026-04-19T10:05:00.000Z");
      expect(updated.status).toBe("done");
      expect(updated.topic).toBe("Should we adopt TypeScript?");
    });
  });

  describe("partial runs", () => {
    it("produces a valid partial tree when only round 1 of 2 completes", () => {
      const runDir = join(testDir, "run-partial");
      const manifest = makeManifest(runDir);
      const writer = createArtifactWriter({
        baseDir: testDir,
        manifest,
        seedBrief: "seed",
      });
      writer.init();

      // Only write round 1
      const r1 = makeRoundResult(1, ["product-manager", "principal-engineer"]);
      writer.writeRound(r1, "brief r1");

      // round-01 exists, round-02 does not
      expect(existsSync(join(runDir, "round-01"))).toBe(true);
      expect(existsSync(join(runDir, "round-02"))).toBe(false);

      // manifest and seed brief exist
      expect(existsSync(join(runDir, "manifest.json"))).toBe(true);
      expect(existsSync(join(runDir, "seed-brief.md"))).toBe(true);

      // No synthesis yet
      expect(existsSync(join(runDir, "synthesis.json"))).toBe(false);
    });
  });

  describe("full run (2 rounds + synthesis)", () => {
    it("produces the complete directory tree", () => {
      const runDir = join(testDir, "run-full");
      const manifest = makeManifest(runDir);
      const agents = ["product-manager", "principal-engineer"];
      const writer = createArtifactWriter({
        baseDir: testDir,
        manifest,
        seedBrief: "# Seed\n\nTopic here",
      });

      writer.init();
      writer.writeRound(makeRoundResult(1, agents), "brief r1");
      writer.writeRound(makeRoundResult(2, agents), "brief r2");
      writer.writeSynthesis(makeSynthesis());
      writer.finalize("2026-04-19T10:05:00.000Z", "done");

      // Verify complete tree
      const expected = [
        "manifest.json",
        "seed-brief.md",
        "synthesis.json",
        "synthesis.md",
        "round-01/brief.md",
        "round-01/agents/product-manager.md",
        "round-01/agents/principal-engineer.md",
        "round-02/brief.md",
        "round-02/agents/product-manager.md",
        "round-02/agents/principal-engineer.md",
      ];

      for (const file of expected) {
        expect(existsSync(join(runDir, file))).toBe(true);
      }

      // Verify finalized manifest
      const finalManifest = JSON.parse(
        readFileSync(join(runDir, "manifest.json"), "utf-8"),
      );
      expect(finalManifest.finishedAt).toBe("2026-04-19T10:05:00.000Z");
    });
  });
});
