import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { AgentDefinition, AgentOutput } from "../../src/schemas/index.js";
import type {
  BackendAdapter,
  AgentResponse,
} from "../../src/backends/index.js";
import type { SwarmRunConfig } from "../../src/lib/config.js";
import { runSwarm } from "../../src/lib/run-swarm.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAgentDef(name: string): AgentDefinition {
  return {
    name,
    description: `${name} agent`,
    persona: `You are the ${name}`,
    prompt: `Analyze the topic as ${name}`,
    backend: "claude",
  };
}

function makeAgentOutput(
  agent: string,
  round: number,
  overrides: Partial<AgentOutput> = {},
): AgentOutput {
  return {
    agent,
    round,
    stance: `${agent}-stance-r${round}`,
    recommendation: `${agent} recommends action for round ${round}`,
    reasoning: [`${agent} reason 1`, `${agent} reason 2`],
    objections: [`${agent} objection`],
    risks: ["shared risk alpha", `${agent}-specific risk`],
    changesFromPriorRound:
      round > 1 ? [`${agent} updated stance in round ${round}`] : [],
    confidence: "high",
    openQuestions: [`${agent} open question`],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock backend
// ---------------------------------------------------------------------------

class MockBackendAdapter implements BackendAdapter {
  /** Record of (agent, round) calls for assertion */
  readonly calls: Array<{ agent: string; prompt: string }> = [];
  private roundCounter = new Map<string, number>();

  constructor(
    private outputs: Map<string, AgentOutput[]>, // agent name → outputs per round
  ) {}

  async dispatch(
    prompt: string,
    agent: AgentDefinition,
  ): Promise<AgentResponse> {
    const roundIdx = this.roundCounter.get(agent.name) ?? 0;
    this.roundCounter.set(agent.name, roundIdx + 1);
    this.calls.push({ agent: agent.name, prompt });

    const agentOutputs = this.outputs.get(agent.name);
    if (!agentOutputs || !agentOutputs[roundIdx]) {
      return {
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "No canned output for this round",
        timedOut: false,
        durationMs: 100,
      };
    }

    return {
      ok: true,
      exitCode: 0,
      stdout: JSON.stringify(agentOutputs[roundIdx]),
      stderr: "",
      timedOut: false,
      durationMs: 1234,
    };
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("e2e: full pipeline with mock backend", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = join(tmpdir(), `swarm-e2e-${randomUUID()}`);
  });

  afterEach(() => {
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  const agents: AgentDefinition[] = [
    makeAgentDef("product-manager"),
    makeAgentDef("principal-engineer"),
  ];

  const config: SwarmRunConfig = {
    topic: "Should we adopt GraphQL",
    rounds: 2,
    preset: null,
    agents: ["product-manager", "principal-engineer"],
    selectionSource: "explicit-agents",
    resolveMode: "orchestrator",
    goal: "Decide on API strategy",
    decision: "GraphQL vs REST",
    docs: [],
    commandText:
      'swarm run 2 "Should we adopt GraphQL" --agents product-manager,principal-engineer --resolve orchestrator',
  };

  function buildMockBackend(): MockBackendAdapter {
    const outputs = new Map<string, AgentOutput[]>();
    outputs.set("product-manager", [
      makeAgentOutput("product-manager", 1),
      makeAgentOutput("product-manager", 2),
    ]);
    outputs.set("principal-engineer", [
      makeAgentOutput("principal-engineer", 1),
      makeAgentOutput("principal-engineer", 2),
    ]);
    return new MockBackendAdapter(outputs);
  }

  it("runs 2 agents × 2 rounds and produces the full artifact tree", async () => {
    const backend = buildMockBackend();
    const startedAt = new Date("2026-01-15T10:30:00.000Z");

    const exitCode = await runSwarm({
      config,
      agents,
      backend,
      baseDir,
      startedAt,
    });

    expect(exitCode).toBe(0);

    // Verify the mock was called correctly: 2 agents × 2 rounds = 4 calls
    expect(backend.calls).toHaveLength(4);
    expect(backend.calls.map((c) => c.agent)).toEqual([
      "product-manager",
      "principal-engineer",
      "product-manager",
      "principal-engineer",
    ]);

    // Derive expected run directory
    const runDir = join(baseDir, "20260115-103000-should-we-adopt-graphql");
    expect(existsSync(runDir)).toBe(true);

    // -- manifest.json --
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );
    expect(manifest.topic).toBe("Should we adopt GraphQL");
    expect(manifest.rounds).toBe(2);
    expect(manifest.agents).toEqual([
      "product-manager",
      "principal-engineer",
    ]);
    expect(manifest.resolveMode).toBe("orchestrator");
    expect(manifest.startedAt).toBe("2026-01-15T10:30:00.000Z");
    expect(manifest.finishedAt).toBeDefined();

    // -- seed-brief.md --
    const seedBrief = readFileSync(join(runDir, "seed-brief.md"), "utf-8");
    expect(seedBrief).toContain("Should we adopt GraphQL");
    expect(seedBrief).toContain("Rounds: 2");

    // -- round-01/ --
    const r1Dir = join(runDir, "round-01");
    expect(existsSync(r1Dir)).toBe(true);
    expect(existsSync(join(r1Dir, "brief.md"))).toBe(true);

    const r1pm = readFileSync(
      join(r1Dir, "agents", "product-manager.md"),
      "utf-8",
    );
    expect(r1pm).toContain("Agent: product-manager");
    expect(r1pm).toContain("Round: 1");
    expect(r1pm).toContain("Status: ok");
    expect(r1pm).toContain("product-manager-stance-r1");

    const r1pe = readFileSync(
      join(r1Dir, "agents", "principal-engineer.md"),
      "utf-8",
    );
    expect(r1pe).toContain("Agent: principal-engineer");

    // -- round-02/ --
    const r2Dir = join(runDir, "round-02");
    expect(existsSync(r2Dir)).toBe(true);
    expect(existsSync(join(r2Dir, "brief.md"))).toBe(true);

    const r2pm = readFileSync(
      join(r2Dir, "agents", "product-manager.md"),
      "utf-8",
    );
    expect(r2pm).toContain("Round: 2");
    expect(r2pm).toContain("product-manager-stance-r2");
    // Round 2 should include changes from prior round
    expect(r2pm).toContain("product-manager updated stance in round 2");

    // Round 2 brief should contain prior round packet JSON
    const r2Brief = readFileSync(join(r2Dir, "brief.md"), "utf-8");
    expect(r2Brief).toContain("Prior Round Packet");
    expect(r2Brief).toContain('"round": 1');

    // -- synthesis.json --
    const synthesis = JSON.parse(
      readFileSync(join(runDir, "synthesis.json"), "utf-8"),
    );
    expect(synthesis.topic).toBe("Should we adopt GraphQL");
    expect(synthesis.rounds).toBe(2);
    expect(synthesis.roundCount).toBe(2);
    expect(synthesis.agentCount).toBe(2);
    expect(synthesis.overallConfidence).toBe("high");
    expect(synthesis.sharedRisks).toContain("shared risk alpha");
    expect(synthesis.stanceTally).toBeInstanceOf(Array);
    expect(synthesis.stanceTally.length).toBeGreaterThan(0);

    // -- synthesis.md --
    const synthesisMd = readFileSync(
      join(runDir, "synthesis.md"),
      "utf-8",
    );
    expect(synthesisMd).toContain(
      "# Synthesis: Should we adopt GraphQL",
    );
    expect(synthesisMd).toContain("Round-by-Round Summary");
    expect(synthesisMd).toContain("### Round 1");
    expect(synthesisMd).toContain("### Round 2");
  });

  it("returns exit code 1 when too few agents succeed", async () => {
    // Only provide output for one agent
    const outputs = new Map<string, AgentOutput[]>();
    outputs.set("product-manager", [makeAgentOutput("product-manager", 1)]);
    // principal-engineer has no outputs → will fail
    const backend = new MockBackendAdapter(outputs);

    const exitCode = await runSwarm({
      config,
      agents,
      backend,
      baseDir,
      startedAt: new Date("2026-01-15T10:30:00.000Z"),
    });

    expect(exitCode).toBe(1);

    // Artifacts should still exist (partial run)
    const runDir = join(baseDir, "20260115-103000-should-we-adopt-graphql");
    expect(existsSync(runDir)).toBe(true);
    expect(existsSync(join(runDir, "manifest.json"))).toBe(true);

    // Should have round-01 artifacts (even though it failed)
    expect(existsSync(join(runDir, "round-01"))).toBe(true);

    // Should NOT have synthesis (run failed)
    expect(existsSync(join(runDir, "synthesis.json"))).toBe(false);

    // Manifest should have finishedAt (finalize still runs)
    const manifest = JSON.parse(
      readFileSync(join(runDir, "manifest.json"), "utf-8"),
    );
    expect(manifest.finishedAt).toBeDefined();
  });

  it("produces consensus when all agents share the same stance", async () => {
    const sharedStance = "adopt GraphQL";
    const outputs = new Map<string, AgentOutput[]>();
    outputs.set("product-manager", [
      makeAgentOutput("product-manager", 1, { stance: sharedStance }),
      makeAgentOutput("product-manager", 2, { stance: sharedStance }),
    ]);
    outputs.set("principal-engineer", [
      makeAgentOutput("principal-engineer", 1, { stance: sharedStance }),
      makeAgentOutput("principal-engineer", 2, { stance: sharedStance }),
    ]);
    const backend = new MockBackendAdapter(outputs);

    const exitCode = await runSwarm({
      config,
      agents,
      backend,
      baseDir,
      startedAt: new Date("2026-01-15T10:30:00.000Z"),
    });

    expect(exitCode).toBe(0);

    const runDir = join(baseDir, "20260115-103000-should-we-adopt-graphql");
    const synthesis = JSON.parse(
      readFileSync(join(runDir, "synthesis.json"), "utf-8"),
    );
    expect(synthesis.consensus).toBe(true);
    expect(synthesis.stanceTally).toHaveLength(1);
    expect(synthesis.stanceTally[0].stance).toBe(sharedStance);
    expect(synthesis.stanceTally[0].count).toBe(2);
  });
});
