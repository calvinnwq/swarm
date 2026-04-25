import { describe, expect, it } from "vitest";
import {
  buildRoundBrief,
  buildSeedBrief,
  buildOrchestratorPassDirective,
  type SwarmRunConfig,
} from "../../../src/lib/index.js";
import {
  AgentOutputSchema,
  type RoundPacket,
} from "../../../src/schemas/index.js";

function configWith(overrides: Partial<SwarmRunConfig> = {}): SwarmRunConfig {
  return {
    topic: "sample topic",
    rounds: 2,
    backend: "claude",
    preset: null,
    agents: ["alpha", "beta"],
    selectionSource: "explicit-agents",
    resolveMode: "off",
    goal: null,
    decision: null,
    docs: [],
    commandText: "run 2 sample topic --agents alpha,beta",
    ...overrides,
  };
}

describe("buildSeedBrief", () => {
  it("renders a minimal config with no optional sections", () => {
    const out = buildSeedBrief(configWith());
    expect(out).toContain("# Swarm Brief");
    expect(out).toContain("Topic: sample topic");
    expect(out).toContain("Rounds: 2");
    expect(out).toContain("Selection source: explicit-agents");
    expect(out).toContain("Preset: none");
    expect(out).toContain("Agents: alpha, beta");
    expect(out).toContain("Resolution mode: off");
    expect(out).toContain("Goal: n/a");
    expect(out).toContain("Decision target: n/a");
    expect(out).toContain("Carry-forward docs: n/a");
    expect(out).not.toContain("## Carry-forward context docs");
    expect(out).not.toContain("## Intent");
    expect(out).not.toContain("## Resolution mode");
    expect(out).toContain("## Output contract");
    expect(out).toContain("## Round instructions");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("includes carry-forward and intent sections when goal/decision/docs are set", () => {
    const out = buildSeedBrief(
      configWith({
        goal: "ship the slice",
        decision: "pick option B",
        docs: ["/tmp/a.md", "/tmp/b.md"],
        preset: "default",
      }),
    );
    expect(out).toContain("Carry-forward docs: /tmp/a.md, /tmp/b.md");
    expect(out).toContain("## Carry-forward context docs");
    expect(out).toContain("- /tmp/a.md");
    expect(out).toContain("- /tmp/b.md");
    expect(out).toContain("## Intent");
    expect(out).toContain("Goal: ship the slice");
    expect(out).toContain("Decision target: pick option B");
    expect(out).toContain("Preset: default");
  });

  it("records resolveMode as metadata without promising a between-round sub-pass (orchestrator)", () => {
    const out = buildSeedBrief(configWith({ resolveMode: "orchestrator" }));
    expect(out).toContain("Resolution mode: orchestrator");
    expect(out).not.toContain("## Resolution mode");
    expect(out).not.toContain("sub-pass");
  });

  it("records resolveMode as metadata without promising a between-round sub-pass (agents)", () => {
    const out = buildSeedBrief(configWith({ resolveMode: "agents" }));
    expect(out).toContain("Resolution mode: agents");
    expect(out).not.toContain("## Resolution mode");
    expect(out).not.toContain("sub-pass");
  });
});

describe("buildSeedBrief output contract typing", () => {
  it("declares a concrete type for each agent-output field that was guessed wrong in real runs", () => {
    const out = buildSeedBrief(configWith());
    expect(out).toContain("## Output contract");
    expect(out).toMatch(/recommendation:\s*string\b/);
    expect(out).toMatch(/reasoning:\s*string\[\]/);
    expect(out).toMatch(/changesFromPriorRound:\s*string\[\]/);
    expect(out).toMatch(/confidence:\s*"low"\s*\|\s*"medium"\s*\|\s*"high"/);
  });

  it("hints that changesFromPriorRound should be [] in round 1", () => {
    const out = buildSeedBrief(configWith());
    expect(out).toMatch(/changesFromPriorRound[\s\S]*\[\][\s\S]*round\s*1/i);
  });

  it("mentions every AgentOutputSchema field in the output contract (drift protection)", () => {
    const out = buildSeedBrief(configWith());
    const fields = Object.keys(AgentOutputSchema.shape);
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(out).toContain(field);
    }
  });
});

const samplePacket: RoundPacket = {
  round: 1,
  agents: ["alpha", "beta"],
  summaries: [
    {
      agent: "alpha",
      stance: "lean toward option B",
      recommendation: "Pick option B and ship a thin slice.",
      objections: [],
      risks: [],
      confidence: "high",
      openQuestions: [],
    },
  ],
  keyObjections: [],
  sharedRisks: [],
  openQuestions: [],
  questionResolutions: [],
  questionResolutionLimit: 3,
  deferredQuestions: [],
};

describe("buildRoundBrief", () => {
  const seedBrief = "# Swarm Brief\n\nTopic: sample topic\n";

  it("renders the opening round when priorPacket is null", () => {
    const out = buildRoundBrief({
      config: configWith(),
      round: 1,
      seedBrief,
      priorPacket: null,
    });
    expect(out).toContain("# Swarm Round Brief");
    expect(out).toContain("Round: 1/2");
    expect(out).toContain("## Seed Brief");
    expect(out).toContain("Topic: sample topic");
    expect(out).toContain("## Prior Round Packet");
    expect(out).toContain(
      "No prior round packet yet. This is the opening round.",
    );
    expect(out).not.toContain("```json");
    expect(out).toContain("## Instructions");
    expect(out).toContain("Stay inside the shared swarm JSON schema.");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("embeds the prior packet as JSON for round 2+", () => {
    const out = buildRoundBrief({
      config: configWith({ rounds: 3 }),
      round: 2,
      seedBrief,
      priorPacket: samplePacket,
    });
    expect(out).toContain("Round: 2/3");
    expect(out).toContain("```json");
    expect(out).toContain('"agent": "alpha"');
    expect(out).toContain(
      '"recommendation": "Pick option B and ship a thin slice."',
    );
    expect(out).toContain("```\n\n## Instructions");
    expect(out).not.toContain("opening round");
  });

  it("preserves seed brief content with trailing whitespace trimmed", () => {
    const out = buildRoundBrief({
      config: configWith(),
      round: 1,
      seedBrief: "# Swarm Brief\n\nTopic: x\n\n\n",
      priorPacket: null,
    });
    // Seed section should not contain trailing blank lines before the next heading
    expect(out).toMatch(/Topic: x\n\n## Prior Round Packet/);
  });

  it("injects orchestratorDirective section before ## Instructions when provided", () => {
    const out = buildRoundBrief({
      config: configWith({ rounds: 3 }),
      round: 2,
      seedBrief,
      priorPacket: samplePacket,
      orchestratorDirective:
        "## Orchestrator Pass — After Round 1\n\n**Stance summary (1 agent(s)):**\n- alpha: lean toward option B",
    });
    expect(out).toContain("## Orchestrator Pass — After Round 1");
    expect(out).toContain("**Stance summary (1 agent(s)):**");
    // Directive appears before Instructions
    const directiveIdx = out.indexOf("## Orchestrator Pass");
    const instructionsIdx = out.indexOf("## Instructions");
    expect(directiveIdx).toBeGreaterThan(0);
    expect(directiveIdx).toBeLessThan(instructionsIdx);
  });

  it("omits orchestratorDirective section when not provided", () => {
    const out = buildRoundBrief({
      config: configWith({ rounds: 3 }),
      round: 2,
      seedBrief,
      priorPacket: samplePacket,
    });
    expect(out).not.toContain("## Orchestrator Pass");
  });
});

describe("buildOrchestratorPassDirective", () => {
  const fullPacket: RoundPacket = {
    round: 1,
    agents: ["alpha", "beta"],
    summaries: [
      {
        agent: "alpha",
        stance: "lean toward option B",
        recommendation: "ship it",
        objections: [],
        risks: [],
        confidence: "high",
        openQuestions: [],
      },
      {
        agent: "beta",
        stance: "cautious about timeline",
        recommendation: "phase it",
        objections: [],
        risks: [],
        confidence: "medium",
        openQuestions: [],
      },
    ],
    keyObjections: ["Risk of scope creep", "Team capacity unclear"],
    sharedRisks: ["Deadline pressure"],
    openQuestions: ["Which team owns deployment?"],
    questionResolutions: [],
    questionResolutionLimit: 3,
    deferredQuestions: [],
  };

  it("includes the round number in the header", () => {
    const out = buildOrchestratorPassDirective(fullPacket);
    expect(out).toContain("## Orchestrator Pass — After Round 1");
  });

  it("lists each agent stance", () => {
    const out = buildOrchestratorPassDirective(fullPacket);
    expect(out).toContain("alpha: lean toward option B");
    expect(out).toContain("beta: cautious about timeline");
  });

  it("lists key objections", () => {
    const out = buildOrchestratorPassDirective(fullPacket);
    expect(out).toContain("Risk of scope creep");
    expect(out).toContain("Team capacity unclear");
  });

  it("lists shared risks", () => {
    const out = buildOrchestratorPassDirective(fullPacket);
    expect(out).toContain("Deadline pressure");
  });

  it("lists open questions", () => {
    const out = buildOrchestratorPassDirective(fullPacket);
    expect(out).toContain("Which team owns deployment?");
  });

  it("omits empty sections", () => {
    const emptyPacket: RoundPacket = {
      ...fullPacket,
      summaries: [],
      keyObjections: [],
      sharedRisks: [],
      openQuestions: [],
    };
    const out = buildOrchestratorPassDirective(emptyPacket);
    expect(out).not.toContain("**Stance summary");
    expect(out).not.toContain("**Key objections");
    expect(out).not.toContain("**Shared risks");
    expect(out).not.toContain("**Open questions");
  });

  it("returns a string that does not end with a newline (trimmed)", () => {
    const out = buildOrchestratorPassDirective(fullPacket);
    expect(out.endsWith("\n")).toBe(false);
  });
});
