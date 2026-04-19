import { describe, expect, it, vi } from "vitest";
import type {
  AgentDefinition,
  AgentOutput,
} from "../../../src/schemas/index.js";
import type {
  AgentResponse,
  BackendAdapter,
} from "../../../src/backends/index.js";
import type { SwarmRunConfig } from "../../../src/lib/config.js";
import {
  createRoundRunner,
  runWithConcurrency,
} from "../../../src/lib/round-runner.js";

// --- Helpers ---

function makeConfig(overrides: Partial<SwarmRunConfig> = {}): SwarmRunConfig {
  return {
    topic: "Should we adopt option B?",
    rounds: 2,
    preset: null,
    agents: ["alpha", "beta", "gamma"],
    selectionSource: "explicit-agents",
    resolveMode: "off",
    goal: null,
    decision: null,
    docs: [],
    commandText: "swarm run 2 Should we adopt option B?",
    ...overrides,
  };
}

function makeAgent(name: string): AgentDefinition {
  return {
    name,
    description: `${name} agent`,
    persona: `You are the ${name} agent.`,
    prompt: `Analyze as ${name}.`,
    backend: "claude",
  };
}

function makeAgentOutput(name: string, round: number): AgentOutput {
  return {
    agent: name,
    round,
    stance: `${name} stance for round ${round}`,
    recommendation: `${name} recommends X in round ${round}`,
    reasoning: [`${name} reason 1`],
    objections: [`${name} objection 1`],
    risks: ["shared risk A", `${name}-specific risk`],
    changesFromPriorRound: round > 1 ? [`${name} changed stance`] : [],
    confidence: "medium",
    openQuestions: [`${name} question 1`],
  };
}

function makeSuccessResponse(output: AgentOutput): AgentResponse {
  return {
    ok: true,
    exitCode: 0,
    stdout: JSON.stringify(output),
    stderr: "",
    timedOut: false,
    durationMs: 100,
  };
}

function makeFailResponse(opts?: Partial<AgentResponse>): AgentResponse {
  return {
    ok: false,
    exitCode: 1,
    stdout: "",
    stderr: "agent error",
    timedOut: false,
    durationMs: 50,
    ...opts,
  };
}

function makeStubBackend(
  handler: (prompt: string, agent: AgentDefinition) => AgentResponse,
): BackendAdapter {
  return {
    dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) =>
      handler(prompt, agent),
    ),
  };
}

// --- Tests ---

describe("runWithConcurrency", () => {
  it("runs all tasks and returns results in order", async () => {
    const tasks = [async () => "a", async () => "b", async () => "c"];
    const results = await runWithConcurrency(tasks, 3);
    expect(results).toEqual(["a", "b", "c"]);
  });

  it("respects concurrency cap", async () => {
    let running = 0;
    let maxRunning = 0;

    const makeTask = (val: string) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return val;
    };

    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];
    const results = await runWithConcurrency(tasks, 1);

    expect(results).toEqual(["a", "b", "c"]);
    expect(maxRunning).toBe(1);
  });
});

describe("createRoundRunner", () => {
  it("runs 2 rounds × 3 agents to completion", async () => {
    const config = makeConfig({ rounds: 2 });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      // Infer round from the brief content — round 1 has "No prior round packet"
      const isRound1 = _prompt.includes("No prior round packet");
      const round = isRound1 ? 1 : 2;
      return makeSuccessResponse(makeAgentOutput(agent.name, round));
    });

    const { emitter, run } = createRoundRunner({
      config,
      agents,
      backend,
      concurrency: 3,
    });

    const events: string[] = [];
    emitter.on("round:start", () => events.push("round:start"));
    emitter.on("agent:start", () => events.push("agent:start"));
    emitter.on("agent:ok", () => events.push("agent:ok"));
    emitter.on("round:done", () => events.push("round:done"));
    emitter.on("run:done", () => events.push("run:done"));

    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.rounds).toHaveLength(2);

    // Each round should have 3 agent results
    for (const rr of result.rounds) {
      expect(rr.agentResults).toHaveLength(3);
      expect(rr.agentResults.every((r) => r.ok)).toBe(true);
    }

    // Round packets should have correct structure
    const packet1 = result.rounds[0].packet;
    expect(packet1.round).toBe(1);
    expect(packet1.agents).toEqual(["alpha", "beta", "gamma"]);
    expect(packet1.summaries).toHaveLength(3);

    // Shared risk "shared risk A" is mentioned by all 3 agents
    expect(packet1.sharedRisks).toContain("shared risk A");

    // Event sequence
    expect(events).toContain("round:start");
    expect(events).toContain("agent:start");
    expect(events).toContain("agent:ok");
    expect(events).toContain("round:done");
    expect(events).toContain("run:done");

    // round:start should appear twice (once per round)
    expect(events.filter((e) => e === "round:start")).toHaveLength(2);
    // agent:start should appear 6 times (3 agents × 2 rounds)
    expect(events.filter((e) => e === "agent:start")).toHaveLength(6);
  });

  it("emits the expected event sequence", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) =>
      makeSuccessResponse(makeAgentOutput(agent.name, 1)),
    );

    const { emitter, run } = createRoundRunner({
      config,
      agents,
      backend,
      concurrency: 10,
    });

    const events: string[] = [];
    emitter.on("round:start", () => events.push("round:start"));
    emitter.on("agent:start", (d) => events.push(`agent:start:${d.agent}`));
    emitter.on("agent:ok", (d) => events.push(`agent:ok:${d.agent}`));
    emitter.on("round:done", () => events.push("round:done"));
    emitter.on("run:done", () => events.push("run:done"));

    await run();

    expect(events[0]).toBe("round:start");
    expect(events).toContain("agent:start:alpha");
    expect(events).toContain("agent:start:beta");
    expect(events).toContain("agent:ok:alpha");
    expect(events).toContain("agent:ok:beta");
    // round:done and run:done come after all agents
    const roundDoneIdx = events.indexOf("round:done");
    const runDoneIdx = events.indexOf("run:done");
    expect(roundDoneIdx).toBeGreaterThan(events.lastIndexOf("agent:ok:beta"));
    expect(runDoneIdx).toBeGreaterThan(roundDoneIdx);
  });

  it("produces two RoundPackets for a 2-round run", async () => {
    const config = makeConfig({ rounds: 2, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      const round = _prompt.includes("No prior round packet") ? 1 : 2;
      return makeSuccessResponse(makeAgentOutput(agent.name, round));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0].packet.round).toBe(1);
    expect(result.rounds[1].packet.round).toBe(2);

    // Round 2 brief should contain prior packet data
    const dispatchCalls = (backend.dispatch as ReturnType<typeof vi.fn>).mock
      .calls;
    // Calls 3 and 4 are round 2 (0-indexed)
    const round2Brief = dispatchCalls[2][0] as string;
    expect(round2Brief).toContain("alpha stance for round 1");
  });

  describe("min-2-success rule", () => {
    it("continues when 1 agent fails out of 3", async () => {
      const config = makeConfig({
        rounds: 1,
        agents: ["alpha", "beta", "gamma"],
      });
      const agents = ["alpha", "beta", "gamma"].map(makeAgent);

      const backend = makeStubBackend((_prompt, agent) => {
        if (agent.name === "gamma") {
          return makeFailResponse();
        }
        return makeSuccessResponse(makeAgentOutput(agent.name, 1));
      });

      const { emitter, run } = createRoundRunner({ config, agents, backend });

      const failEvents: string[] = [];
      emitter.on("agent:fail", (d) => failEvents.push(d.agent));

      const result = await run();

      expect(result.ok).toBe(true);
      expect(failEvents).toEqual(["gamma"]);
      expect(result.rounds[0].packet.summaries).toHaveLength(2);
    });

    it("fails the run when 2 agents fail out of 3", async () => {
      const config = makeConfig({
        rounds: 1,
        agents: ["alpha", "beta", "gamma"],
      });
      const agents = ["alpha", "beta", "gamma"].map(makeAgent);

      const backend = makeStubBackend((_prompt, agent) => {
        if (agent.name !== "alpha") {
          return makeFailResponse();
        }
        return makeSuccessResponse(makeAgentOutput(agent.name, 1));
      });

      const { run } = createRoundRunner({ config, agents, backend });
      const result = await run();

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/only 1 agent.*succeeded.*minimum 2/);
    });

    it("fails the run when all agents fail", async () => {
      const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
      const agents = ["alpha", "beta"].map(makeAgent);

      const backend = makeStubBackend(() => makeFailResponse());

      const { run } = createRoundRunner({ config, agents, backend });
      const result = await run();

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/only 0 agent.*succeeded/);
    });
  });

  describe("concurrency cap", () => {
    it("with cap=1 and 3 agents, dispatches are serial", async () => {
      const config = makeConfig({
        rounds: 1,
        agents: ["alpha", "beta", "gamma"],
      });
      const agents = ["alpha", "beta", "gamma"].map(makeAgent);

      let running = 0;
      let maxRunning = 0;

      const backend: BackendAdapter = {
        dispatch: vi.fn(async (_prompt, agent) => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await new Promise((r) => setTimeout(r, 10));
          running--;
          return makeSuccessResponse(makeAgentOutput(agent.name, 1));
        }),
      };

      const { run } = createRoundRunner({
        config,
        agents,
        backend,
        concurrency: 1,
      });

      await run();

      expect(maxRunning).toBe(1);
      expect(
        (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
      ).toHaveLength(3);
    });
  });

  it("handles agent returning invalid JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: "Not valid JSON at all",
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }
      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    // Only 1 success → fails min-2-success
    expect(result.ok).toBe(false);
  });

  it("handles agent returning valid JSON that fails schema", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "gamma") {
        return {
          ok: true,
          exitCode: 0,
          stdout: JSON.stringify({ agent: "gamma", round: 1 }), // missing required fields
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }
      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    // 2 succeed, 1 fails schema → still ok
    expect(result.ok).toBe(true);
    const gamma = result.rounds[0].agentResults.find(
      (r) => r.agent === "gamma",
    );
    expect(gamma?.ok).toBe(false);
    expect(gamma?.error).toMatch(/Schema validation failed/);
  });

  it("handles timed-out agent", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return makeFailResponse({ timedOut: true, durationMs: 120_000 });
      }
      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(false);
    expect(beta?.error).toMatch(/timed out/);
  });

  it("handles backend dispatch throwing an error", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (_prompt, agent) => {
        if (agent.name === "gamma") {
          throw new Error("connection refused");
        }
        return makeSuccessResponse(makeAgentOutput(agent.name, 1));
      }),
    };

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const gamma = result.rounds[0].agentResults.find(
      (r) => r.agent === "gamma",
    );
    expect(gamma?.ok).toBe(false);
    expect(gamma?.error).toMatch(/connection refused/);
  });

  it("feeds round 1 packet into round 2 brief", async () => {
    const config = makeConfig({ rounds: 2, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const briefs: string[] = [];
    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        briefs.push(prompt);
        const round = prompt.includes("No prior round packet") ? 1 : 2;
        return makeSuccessResponse(makeAgentOutput(agent.name, round));
      }),
    };

    const { run } = createRoundRunner({ config, agents, backend });
    await run();

    // Round 2 briefs (indices 2 and 3) should contain round 1 data
    expect(briefs[2]).toContain("alpha stance for round 1");
    expect(briefs[2]).toContain("beta stance for round 1");
    expect(briefs[2]).not.toContain("No prior round packet");
  });
});
