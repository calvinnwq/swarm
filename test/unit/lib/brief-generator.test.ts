import { describe, expect, it } from "vitest";
import {
  buildRoundBrief,
  buildSeedBrief,
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

  it("emits the orchestrator resolution-mode line when resolve=orchestrator", () => {
    const out = buildSeedBrief(configWith({ resolveMode: "orchestrator" }));
    expect(out).toContain("## Resolution mode");
    expect(out).toContain(
      "The orchestrator runs the question-resolution sub-pass between rounds before continuing.",
    );
    expect(out).not.toContain("selected swarm agents run");
  });

  it("emits the agents resolution-mode line when resolve=agents", () => {
    const out = buildSeedBrief(configWith({ resolveMode: "agents" }));
    expect(out).toContain("## Resolution mode");
    expect(out).toContain(
      "The selected swarm agents run the question-resolution sub-pass between rounds before continuing.",
    );
    expect(out).not.toContain("The orchestrator runs");
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
});
