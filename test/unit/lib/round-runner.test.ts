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
    backend: "claude",
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

  it("uses backend-specific JSON extraction instead of assuming Claude output parsing", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = {
      wrapperName: "custom-backend",
      dispatch: vi.fn(async (_prompt: string, agent: AgentDefinition) => ({
        ok: true,
        exitCode: 0,
        stdout: `custom-prefix::${agent.name}`,
        stderr: "",
        timedOut: false,
        durationMs: 100,
      })),
      extractOutputJson: vi.fn((raw: string) => {
        const agent = raw.split("::")[1] ?? "unknown";
        return makeAgentOutput(agent, 1);
      }),
      formatFailure: vi.fn((response: AgentResponse) => response.stderr),
    } as unknown as BackendAdapter;

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.rounds[0]?.agentResults.every((entry) => entry.ok)).toBe(
      true,
    );
    expect(
      (backend.extractOutputJson as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
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

  it("repairs malformed JSON with one retry", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "beta" && !prompt.includes("Validation error:")) {
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
      }),
    };

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(3);
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

  it("repairs schema-invalid JSON with one retry", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: JSON.stringify({ agent: "gamma", round: 1 }),
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(4);
  });

  it("repairs a later schema-invalid agent payload instead of earlier irrelevant JSON metadata", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `${JSON.stringify({ note: "ignore me" })}\n\n${JSON.stringify(
              {
                agent: "gamma",
                round: 1,
                recommendation: "missing required fields",
              },
            )}`,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"agent"');
  });

  it("repairs a later schema-invalid agent payload instead of earlier irrelevant json-fenced metadata", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `\`\`\`json
${JSON.stringify({ note: "ignore fenced metadata" })}
\`\`\`

${JSON.stringify({
  agent: "gamma",
  round: 1,
  recommendation: "missing required fields",
})}`,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"agent"');
  });

  it("repairs a later schema-invalid agent payload instead of earlier irrelevant bare-fenced metadata", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `\`\`\`
${JSON.stringify({ note: "ignore bare fenced metadata" })}
\`\`\`

${JSON.stringify({
  agent: "gamma",
  round: 1,
  recommendation: "missing required fields",
})}`,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"agent"');
  });

  it("repairs a later schema-invalid agent payload instead of earlier malformed plain JSON", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `{ "broken": \n\n${JSON.stringify({
              agent: "gamma",
              round: 1,
              recommendation: "missing required fields",
            })}`,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"agent"');
  });

  it("repairs a later schema-invalid agent payload instead of earlier malformed fenced JSON", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `\`\`\`json
{ "broken": 
\`\`\`

${JSON.stringify({
  agent: "gamma",
  round: 1,
  recommendation: "missing required fields",
})}`,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"agent"');
  });

  it("repairs a later schema-invalid agent payload instead of earlier malformed bare-fenced JSON", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `\`\`\`
{ "broken": 
\`\`\`

${JSON.stringify({
  agent: "gamma",
  round: 1,
  recommendation: "missing required fields",
})}`,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"agent"');
  });

  it("repairs the first schema-invalid agent payload when multiple agent-like candidates are invalid", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `${JSON.stringify({
              agent: "gamma",
              round: 1,
              recommendation: "keep first invalid payload",
              reasoning: ["reason 1"],
              objections: ["objection 1"],
              risks: ["risk 1"],
              changesFromPriorRound: [],
              confidence: "medium",
              openQuestions: ["question 1"],
            })}



\`\`\`json
${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation instead",
  reasoning: ["reason 2"],
  objections: ["objection 2"],
  risks: ["risk 2"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 2"],
})}
\`\`\``,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"recommendation"');
  });

  it("repairs the first json-fenced schema-invalid agent payload when a later plain agent-like payload is also invalid", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `\`\`\`json
${JSON.stringify({
  agent: "gamma",
  round: 1,
  recommendation: "keep fenced invalid payload",
  reasoning: ["reason 1"],
  objections: ["objection 1"],
  risks: ["risk 1"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 1"],
})}
\`\`\`

${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation instead",
  reasoning: ["reason 2"],
  objections: ["objection 2"],
  risks: ["risk 2"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 2"],
})}`,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"recommendation"');
  });

  it("repairs the first json-fenced schema-invalid agent payload when a later bare-fenced agent-like payload is also invalid", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `\`\`\`json
${JSON.stringify({
  agent: "gamma",
  round: 1,
  recommendation: "keep json-fenced invalid payload",
  reasoning: ["reason 1"],
  objections: ["objection 1"],
  risks: ["risk 1"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 1"],
})}
\`\`\`

\`\`\`
${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation instead",
  reasoning: ["reason 2"],
  objections: ["objection 2"],
  risks: ["risk 2"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 2"],
})}
\`\`\``,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"recommendation"');
  });

  it("repairs the first json-fenced schema-invalid agent payload when a later json-fenced agent-like payload is also invalid", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `\`\`\`json
${JSON.stringify({
  agent: "gamma",
  round: 1,
  recommendation: "keep first json-fenced invalid payload",
  reasoning: ["reason 1"],
  objections: ["objection 1"],
  risks: ["risk 1"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 1"],
})}
\`\`\`

\`\`\`json
${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation instead",
  reasoning: ["reason 2"],
  objections: ["objection 2"],
  risks: ["risk 2"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 2"],
})}
\`\`\``,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"recommendation"');
  });

  it("repairs the first bare-fenced schema-invalid agent payload when a later plain agent-like payload is also invalid", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `\`\`\`
${JSON.stringify({
  agent: "gamma",
  round: 1,
  recommendation: "keep bare-fenced invalid payload",
  reasoning: ["reason 1"],
  objections: ["objection 1"],
  risks: ["risk 1"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 1"],
})}
\`\`\`

${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation instead",
  reasoning: ["reason 2"],
  objections: ["objection 2"],
  risks: ["risk 2"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 2"],
})}`,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"recommendation"');
  });

  it("repairs the first bare-fenced schema-invalid agent payload when a later json-fenced agent-like payload is also invalid", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `\`\`\`
${JSON.stringify({
  agent: "gamma",
  round: 1,
  recommendation: "keep bare-fenced invalid payload",
  reasoning: ["reason 1"],
  objections: ["objection 1"],
  risks: ["risk 1"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 1"],
})}
\`\`\`

\`\`\`json
${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation instead",
  reasoning: ["reason 2"],
  objections: ["objection 2"],
  risks: ["risk 2"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 2"],
})}
\`\`\``,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"recommendation"');
  });

  it("repairs the first bare-fenced schema-invalid agent payload when a later bare-fenced agent-like payload is also invalid", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `\`\`\`
${JSON.stringify({
  agent: "gamma",
  round: 1,
  recommendation: "keep first bare-fenced invalid payload",
  reasoning: ["reason 1"],
  objections: ["objection 1"],
  risks: ["risk 1"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 1"],
})}
\`\`\`

\`\`\`
${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation instead",
  reasoning: ["reason 2"],
  objections: ["objection 2"],
  risks: ["risk 2"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 2"],
})}
\`\`\``,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"recommendation"');
  });

  it("repairs the first plain schema-invalid agent payload when a later bare-fenced agent-like payload is also invalid", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `${JSON.stringify({
              agent: "gamma",
              round: 1,
              recommendation: "keep plain invalid payload",
              reasoning: ["reason 1"],
              objections: ["objection 1"],
              risks: ["risk 1"],
              changesFromPriorRound: [],
              confidence: "medium",
              openQuestions: ["question 1"],
            })}

\`\`\`
${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation instead",
  reasoning: ["reason 2"],
  objections: ["objection 2"],
  risks: ["risk 2"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 2"],
})}
\`\`\``,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"recommendation"');
  });

  it("repairs the first plain schema-invalid agent payload when a later plain agent-like payload is also invalid", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `${JSON.stringify({
              agent: "gamma",
              round: 1,
              recommendation: "keep first plain invalid payload",
              reasoning: ["reason 1"],
              objections: ["objection 1"],
              risks: ["risk 1"],
              changesFromPriorRound: [],
              confidence: "medium",
              openQuestions: ["question 1"],
            })}

${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation instead",
  reasoning: ["reason 2"],
  objections: ["objection 2"],
  risks: ["risk 2"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 2"],
})}`,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"recommendation"');
  });

  it("repairs the first plain schema-invalid agent payload when later json-fenced and bare-fenced agent-like payloads are also invalid", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `${JSON.stringify({
              agent: "gamma",
              round: 1,
              recommendation: "keep first plain invalid payload",
              reasoning: ["reason 1"],
              objections: ["objection 1"],
              risks: ["risk 1"],
              changesFromPriorRound: [],
              confidence: "medium",
              openQuestions: ["question 1"],
            })}

\`\`\`json
${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation in json fence",
  reasoning: ["reason 2"],
  objections: ["objection 2"],
  risks: ["risk 2"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 2"],
})}
\`\`\`

\`\`\`
${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation in bare fence",
  reasoning: ["reason 3"],
  objections: ["objection 3"],
  risks: ["risk 3"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 3"],
})}
\`\`\``,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"recommendation"');
  });

  it("repairs the first json-fenced schema-invalid agent payload when later plain and bare-fenced agent-like payloads are also invalid", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `\`\`\`json
${JSON.stringify({
  agent: "gamma",
  round: 1,
  recommendation: "keep first json-fenced invalid payload",
  reasoning: ["reason 1"],
  objections: ["objection 1"],
  risks: ["risk 1"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 1"],
})}
\`\`\`

${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation in plain JSON",
  reasoning: ["reason 2"],
  objections: ["objection 2"],
  risks: ["risk 2"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 2"],
})}

\`\`\`
${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation in bare fence",
  reasoning: ["reason 3"],
  objections: ["objection 3"],
  risks: ["risk 3"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 3"],
})}
\`\`\``,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"recommendation"');
  });

  it("repairs the first bare-fenced schema-invalid agent payload when later plain and json-fenced agent-like payloads are also invalid", async () => {
    const config = makeConfig({
      rounds: 1,
      agents: ["alpha", "beta", "gamma"],
    });
    const agents = ["alpha", "beta", "gamma"].map(makeAgent);

    const backend: BackendAdapter = {
      dispatch: vi.fn(async (prompt: string, agent: AgentDefinition) => {
        if (agent.name === "gamma" && !prompt.includes("Validation error:")) {
          return {
            ok: true,
            exitCode: 0,
            stdout: `\`\`\`
${JSON.stringify({
  agent: "gamma",
  round: 1,
  recommendation: "keep first bare-fenced invalid payload",
  reasoning: ["reason 1"],
  objections: ["objection 1"],
  risks: ["risk 1"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 1"],
})}
\`\`\`

${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation in plain JSON",
  reasoning: ["reason 2"],
  objections: ["objection 2"],
  risks: ["risk 2"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 2"],
})}

\`\`\`json
${JSON.stringify({
  agent: "gamma",
  round: 1,
  stance: "missing recommendation in json fence",
  reasoning: ["reason 3"],
  objections: ["objection 3"],
  risks: ["risk 3"],
  changesFromPriorRound: [],
  confidence: "medium",
  openQuestions: ["question 3"],
})}
\`\`\``,
            stderr: "",
            timedOut: false,
            durationMs: 50,
          };
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
    expect(gamma?.ok).toBe(true);

    const gammaRepairCall = (
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, AgentDefinition]
      >
    ).find(
      ([prompt, dispatchedAgent]) =>
        dispatchedAgent.name === "gamma" &&
        prompt.includes("Validation error:"),
    );

    expect(gammaRepairCall).toBeDefined();
    const validationSection = gammaRepairCall?.[0].split(
      "Return only a single valid JSON object",
    )[0];
    expect(validationSection).toContain('"stance"');
    expect(validationSection).not.toContain('"recommendation"');
  });

  it("accepts the first schema-valid payload when stdout contains multiple JSON objects", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ note: "ignore me" })}\n\n${JSON.stringify(makeAgentOutput("beta", 1))}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later schema-valid payload when stdout starts with fenced JSON metadata", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify({ note: "ignore fenced metadata" })}\n\`\`\`\n\n${JSON.stringify(makeAgentOutput("beta", 1))}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later json-fenced schema-valid payload when stdout starts with json-fenced JSON metadata", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify({ note: "ignore fenced metadata" })}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(makeAgentOutput("beta", 1))}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later json-fenced schema-valid payload when stdout starts with irrelevant JSON metadata", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ note: "ignore me" })}\n\n\`\`\`json\n${JSON.stringify(makeAgentOutput("beta", 1))}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later schema-valid payload when stdout starts with irrelevant JSON metadata", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ note: "ignore me" })}\n\n${JSON.stringify(makeAgentOutput("beta", 1))}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later bare-fenced schema-valid payload when stdout starts with irrelevant JSON metadata", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ note: "ignore me" })}

\`\`\`
${JSON.stringify(makeAgentOutput("beta", 1))}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later schema-valid payload when stdout starts with bare-fenced JSON metadata", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`
${JSON.stringify({ note: "ignore bare fenced metadata" })}
\`\`\`

${JSON.stringify(makeAgentOutput("beta", 1))}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later json-fenced schema-valid payload when stdout starts with bare-fenced JSON metadata", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`
${JSON.stringify({ note: "ignore bare fenced metadata" })}
\`\`\`

\`\`\`json
${JSON.stringify(makeAgentOutput("beta", 1))}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later bare-fenced schema-valid payload when stdout starts with bare-fenced JSON metadata", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`
${JSON.stringify({ note: "ignore bare fenced metadata" })}
\`\`\`

\`\`\`
${JSON.stringify(makeAgentOutput("beta", 1))}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later bare-fenced schema-valid payload when stdout starts with json-fenced JSON metadata", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json
${JSON.stringify({ note: "ignore fenced metadata" })}
\`\`\`

\`\`\`
${JSON.stringify(makeAgentOutput("beta", 1))}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest plain schema-valid payload when earlier json-fenced metadata and later json-fenced plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify({ note: "ignore fenced metadata" })}\n\`\`\`\n\n${JSON.stringify(validPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier json-fenced metadata and later plain plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify({ note: "ignore fenced metadata" })}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(makeAgentOutput("beta", 1))}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts agent output wrapped in bare fences", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`\n${JSON.stringify(makeAgentOutput("beta", 1))}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later schema-valid payload when stdout starts with schema-invalid agent-like JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ agent: "beta", round: 1, recommendation: "missing required fields" })}\n\n${JSON.stringify(makeAgentOutput("beta", 1))}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later json-fenced schema-valid payload when stdout starts with schema-invalid agent-like JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ agent: "beta", round: 1, recommendation: "missing required fields" })}\n\n\`\`\`json\n${JSON.stringify(makeAgentOutput("beta", 1))}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later bare-fenced schema-valid payload when stdout starts with schema-invalid agent-like JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ agent: "beta", round: 1, recommendation: "missing required fields" })}

\`\`\`
${JSON.stringify(makeAgentOutput("beta", 1))}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later schema-valid payload when stdout starts with fenced schema-invalid agent-like JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify({ agent: "beta", round: 1, recommendation: "missing required fields" })}\n\`\`\`\n\n${JSON.stringify(makeAgentOutput("beta", 1))}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later json-fenced schema-valid payload when stdout starts with fenced schema-invalid agent-like JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify({ agent: "beta", round: 1, recommendation: "missing required fields" })}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(makeAgentOutput("beta", 1))}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later bare-fenced schema-valid payload when stdout starts with fenced schema-invalid agent-like JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify({ agent: "beta", round: 1, recommendation: "missing required fields" })}\n\`\`\`\n\n\`\`\`
${JSON.stringify(makeAgentOutput("beta", 1))}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest plain schema-valid payload when earlier fenced schema-invalid agent-like JSON and later json-fenced plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify(earlierInvalidPayload)}\n\`\`\`\n\n${JSON.stringify(validPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier fenced schema-invalid agent-like JSON and later plain plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify(earlierInvalidPayload)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later schema-valid payload when stdout starts with bare-fenced schema-invalid agent-like JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`
${JSON.stringify({ agent: "beta", round: 1, recommendation: "missing required fields" })}
\`\`\`

${JSON.stringify(makeAgentOutput("beta", 1))}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later json-fenced schema-valid payload when stdout starts with bare-fenced schema-invalid agent-like JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`
${JSON.stringify({ agent: "beta", round: 1, recommendation: "missing required fields" })}
\`\`\`

\`\`\`json
${JSON.stringify(makeAgentOutput("beta", 1))}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later bare-fenced schema-valid payload when stdout starts with bare-fenced schema-invalid agent-like JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`
${JSON.stringify({ agent: "beta", round: 1, recommendation: "missing required fields" })}
\`\`\`

\`\`\`
${JSON.stringify(makeAgentOutput("beta", 1))}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest plain schema-valid payload when earlier bare-fenced schema-invalid agent-like JSON and later json-fenced plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const validPayload = {
          ...makeAgentOutput("beta", 1),
          round: 1,
        };
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`\n${JSON.stringify(earlierInvalidPayload)}\n\`\`\`\n\n${JSON.stringify(validPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier bare-fenced schema-invalid agent-like JSON and later plain plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const validPayload = {
          ...makeAgentOutput("beta", 1),
          round: 1,
        };
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`\n${JSON.stringify(earlierInvalidPayload)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier bare-fenced schema-invalid agent-like JSON and later plain plus json-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const validPayload = {
          ...makeAgentOutput("beta", 1),
          round: 1,
        };
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`\n${JSON.stringify(earlierInvalidPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later schema-valid payload when stdout starts with malformed fenced JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n{ "broken": \n\`\`\`\n\n${JSON.stringify(makeAgentOutput("beta", 1))}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later json-fenced schema-valid payload when stdout starts with malformed fenced JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n{ "broken": \n\`\`\`\n\n\`\`\`json\n${JSON.stringify(makeAgentOutput("beta", 1))}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later bare-fenced schema-valid payload when stdout starts with malformed fenced JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n{ "broken": \n\`\`\`\n\n\`\`\`
${JSON.stringify(makeAgentOutput("beta", 1))}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest plain schema-valid payload when earlier malformed fenced JSON and later json-fenced plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n{ "broken": \n\`\`\`\n\n${JSON.stringify(validPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier malformed fenced JSON and later plain plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n{ "broken": \n\`\`\`\n\n\`\`\`json\n${JSON.stringify(makeAgentOutput("beta", 1))}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier malformed fenced JSON and later plain plus json-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n{ "broken": \n\`\`\`\n\n\`\`\`\n${JSON.stringify(makeAgentOutput("beta", 1))}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later schema-valid payload when stdout starts with malformed plain JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `{ "broken": \n\n${JSON.stringify(makeAgentOutput("beta", 1))}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest plain schema-valid payload when earlier malformed plain JSON and later json-fenced plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `{ "broken": \n\n${JSON.stringify(validPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier malformed plain JSON and later plain plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `{ "broken": \n\n\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier malformed plain JSON and later plain plus json-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `{ "broken": \n\n\`\`\`\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later json-fenced schema-valid payload when stdout starts with malformed plain JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `{ "broken": \n\n\`\`\`json\n${JSON.stringify(makeAgentOutput("beta", 1))}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later bare-fenced schema-valid payload when stdout starts with malformed plain JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `{ "broken": \n\n\`\`\`\n${JSON.stringify(makeAgentOutput("beta", 1))}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later schema-valid payload when stdout starts with malformed bare-fenced JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`
{ "broken": 
\`\`\`

${JSON.stringify(makeAgentOutput("beta", 1))}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later json-fenced schema-valid payload when stdout starts with malformed bare-fenced JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`
{ "broken": 
\`\`\`

\`\`\`json
${JSON.stringify(makeAgentOutput("beta", 1))}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("accepts a later bare-fenced schema-valid payload when stdout starts with malformed bare-fenced JSON", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`
{ "broken": 
\`\`\`

\`\`\`
${JSON.stringify(makeAgentOutput("beta", 1))}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest plain schema-valid payload when earlier malformed bare-fenced JSON and later json-fenced plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`\n{ "broken": \n\`\`\`\n\n${JSON.stringify(validPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier malformed bare-fenced JSON and later plain plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`\n{ "broken": \n\`\`\`\n\n\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier malformed bare-fenced JSON and later plain plus json-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`\n{ "broken": \n\`\`\`\n\n\`\`\`\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the first schema-valid payload when stdout contains multiple valid agent outputs", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const firstPayload = makeAgentOutput("beta", 1);
        const laterPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(firstPayload)}\n\n${JSON.stringify(laterPayload)}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earlier plain schema-valid payload when a later fenced payload is also valid", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const firstPayload = makeAgentOutput("beta", 1);
        const laterPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(firstPayload)}\n\n\`\`\`json\n${JSON.stringify(laterPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earlier fenced schema-valid payload when a later plain payload is also valid", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const firstPayload = makeAgentOutput("beta", 1);
        const laterPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify(firstPayload)}\n\`\`\`\n\n${JSON.stringify(laterPayload)}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earlier fenced schema-valid payload when a later fenced payload is also valid", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const firstPayload = makeAgentOutput("beta", 1);
        const laterPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify(firstPayload)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(laterPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earlier bare fenced schema-valid payload when a later bare fenced payload is also valid", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const firstPayload = makeAgentOutput("beta", 1);
        const laterPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later bare fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`
${JSON.stringify(firstPayload)}
\`\`\`

\`\`\`
${JSON.stringify(laterPayload)}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earlier plain schema-valid payload when a later bare fenced payload is also valid", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const firstPayload = makeAgentOutput("beta", 1);
        const laterPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later bare fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(firstPayload)}\n\n\`\`\`\n${JSON.stringify(laterPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earlier bare fenced schema-valid payload when a later plain payload is also valid", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const firstPayload = makeAgentOutput("beta", 1);
        const laterPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`
${JSON.stringify(firstPayload)}
\`\`\`

${JSON.stringify(laterPayload)}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earlier json-fenced schema-valid payload when a later bare fenced payload is also valid", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const firstPayload = makeAgentOutput("beta", 1);
        const laterPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later bare fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify(firstPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(laterPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earlier bare fenced schema-valid payload when a later json-fenced payload is also valid", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const firstPayload = makeAgentOutput("beta", 1);
        const laterPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`\n${JSON.stringify(firstPayload)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(laterPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earlier plain schema-valid payload when later json-fenced and bare-fenced payloads are also valid", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const firstPayload = makeAgentOutput("beta", 1);
        const laterJsonFencedPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        const laterBareFencedPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(firstPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(laterBareFencedPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earlier json-fenced schema-valid payload when later plain and bare-fenced payloads are also valid", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const firstPayload = makeAgentOutput("beta", 1);
        const laterPlainPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterBareFencedPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify(firstPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainPayload)}\n\n\`\`\`\n${JSON.stringify(laterBareFencedPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earlier bare-fenced schema-valid payload when later plain and json-fenced payloads are also valid", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const firstPayload = makeAgentOutput("beta", 1);
        const laterPlainPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterJsonFencedPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later json fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`\n${JSON.stringify(firstPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest schema-valid payload when invalid agent-like payloads appear before and after it", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterInvalidPayload = {
          agent: "beta",
          round: 1,
          stance: "later invalid payload should be ignored",
          reasoning: ["reason"],
          objections: ["objection"],
          risks: ["risk"],
          changesFromPriorRound: [],
          confidence: "medium",
          openQuestions: ["question"],
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(earlierInvalidPayload)}\n\n${JSON.stringify(validPayload)}\n\n\`\`\`\n${JSON.stringify(laterInvalidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest plain schema-valid payload when an earlier invalid payload and later json-fenced valid payload are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(earlierInvalidPayload)}\n\n${JSON.stringify(validPayload)}\n\n\`\`\`json\n${JSON.stringify(laterValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest plain schema-valid payload when an earlier invalid payload and later bare-fenced valid payload are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(earlierInvalidPayload)}\n\n${JSON.stringify(validPayload)}\n\n\`\`\`\n${JSON.stringify(laterValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest plain schema-valid payload when an earlier invalid payload and later json-fenced plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(earlierInvalidPayload)}\n\n${JSON.stringify(validPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest plain schema-valid payload when earlier irrelevant metadata and a later json-fenced valid payload are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ note: "ignore me" })}\n\n${JSON.stringify(validPayload)}\n\n\`\`\`json\n${JSON.stringify(laterValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest plain schema-valid payload when earlier irrelevant metadata and a later bare-fenced valid payload are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ note: "ignore me" })}

${JSON.stringify(validPayload)}

\`\`\`
${JSON.stringify(laterValidPayload)}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier irrelevant metadata and a later plain valid payload are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ note: "ignore me" })}

\`\`\`json
${JSON.stringify(validPayload)}
\`\`\`

${JSON.stringify(laterValidPayload)}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier irrelevant metadata and a later bare-fenced valid payload are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ note: "ignore me" })}

\`\`\`json
${JSON.stringify(validPayload)}
\`\`\`

\`\`\`
${JSON.stringify(laterValidPayload)}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier irrelevant metadata and a later plain valid payload are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ note: "ignore me" })}

\`\`\`
${JSON.stringify(validPayload)}
\`\`\`

${JSON.stringify(laterValidPayload)}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier irrelevant metadata and a later json-fenced valid payload are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ note: "ignore me" })}

\`\`\`
${JSON.stringify(validPayload)}
\`\`\`

\`\`\`json
${JSON.stringify(laterValidPayload)}
\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest plain schema-valid payload when earlier irrelevant metadata and later json-fenced plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ note: "ignore me" })}\n\n${JSON.stringify(validPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier irrelevant metadata and later plain plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ note: "ignore me" })}\n\n\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest plain schema-valid payload when earlier bare-fenced irrelevant metadata and later json-fenced plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`\n${JSON.stringify({ note: "ignore bare fenced metadata" })}\n\`\`\`\n\n${JSON.stringify(validPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest json-fenced schema-valid payload when earlier bare-fenced irrelevant metadata and later plain plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`\n${JSON.stringify({ note: "ignore bare fenced metadata" })}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier bare-fenced irrelevant metadata and later plain plus json-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`\n${JSON.stringify({ note: "ignore bare fenced metadata" })}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier json-fenced irrelevant metadata and later plain plus json-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify({ note: "ignore fenced metadata" })}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest bare-fenced schema-valid payload when earlier irrelevant metadata and later plain plus json-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify({ note: "ignore me" })}\n\n\`\`\`\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest json-fenced schema-valid payload when invalid agent-like payloads appear before and after it", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterInvalidPayload = {
          agent: "beta",
          round: 1,
          stance: "later invalid payload should be ignored",
          reasoning: ["reason"],
          objections: ["objection"],
          risks: ["risk"],
          changesFromPriorRound: [],
          confidence: "medium",
          openQuestions: ["question"],
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(earlierInvalidPayload)}\n\n\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(laterInvalidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest json-fenced schema-valid payload when an earlier invalid payload and later plain valid payload are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(earlierInvalidPayload)}\n\n\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterValidPayload)}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest json-fenced schema-valid payload when an earlier invalid payload and later bare-fenced valid payload are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(earlierInvalidPayload)}\n\n\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(laterValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest json-fenced schema-valid payload when an earlier invalid payload and later plain plus bare-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterBareFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later bare-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(earlierInvalidPayload)}\n\n\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`\n${JSON.stringify(laterBareFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest bare-fenced schema-valid payload when an earlier json-fenced schema-invalid payload and later plain plus json-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `\`\`\`json\n${JSON.stringify(earlierInvalidPayload)}\n\`\`\`\n\n\`\`\`\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest bare-fenced schema-valid payload when an earlier invalid payload and later plain plus json-fenced valid payloads are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterPlainValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        const laterJsonFencedValidPayload = {
          ...makeAgentOutput("beta", 3),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(earlierInvalidPayload)}\n\n\`\`\`\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterPlainValidPayload)}\n\n\`\`\`json\n${JSON.stringify(laterJsonFencedValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest bare-fenced schema-valid payload when invalid agent-like payloads appear before and after it", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterInvalidPayload = {
          agent: "beta",
          round: 1,
          stance: "later invalid payload should be ignored",
          reasoning: ["reason"],
          objections: ["objection"],
          risks: ["risk"],
          changesFromPriorRound: [],
          confidence: "medium",
          openQuestions: ["question"],
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(earlierInvalidPayload)}\n\n\`\`\`\n${JSON.stringify(validPayload)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(laterInvalidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest bare-fenced schema-valid payload when an earlier invalid payload and later plain valid payload are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later plain recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(earlierInvalidPayload)}\n\n\`\`\`\n${JSON.stringify(validPayload)}\n\`\`\`\n\n${JSON.stringify(laterValidPayload)}`,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the earliest bare-fenced schema-valid payload when an earlier invalid payload and later json-fenced valid payload are also present", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      if (agent.name === "beta") {
        const validPayload = makeAgentOutput("beta", 1);
        const earlierInvalidPayload = {
          agent: "beta",
          round: 1,
          recommendation: "missing required fields",
        };
        const laterValidPayload = {
          ...makeAgentOutput("beta", 2),
          round: 1,
          recommendation: "later json-fenced recommendation should be ignored",
        };
        return {
          ok: true,
          exitCode: 0,
          stdout: `${JSON.stringify(earlierInvalidPayload)}\n\n\`\`\`\n${JSON.stringify(validPayload)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(laterValidPayload)}\n\`\`\``,
          stderr: "",
          timedOut: false,
          durationMs: 50,
        };
      }

      return makeSuccessResponse(makeAgentOutput(agent.name, 1));
    });

    const { run } = createRoundRunner({ config, agents, backend });
    const result = await run();

    expect(result.ok).toBe(true);
    const beta = result.rounds[0].agentResults.find((r) => r.agent === "beta");
    expect(beta?.ok).toBe(true);
    expect(beta?.output?.recommendation).toBe(
      makeAgentOutput("beta", 1).recommendation,
    );
    expect(beta?.output?.round).toBe(1);
    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
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

  it("calls betweenRounds after each non-final round with the round packet", async () => {
    const config = makeConfig({ rounds: 3, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) => {
      const round = _prompt.includes("No prior round packet")
        ? 1
        : _prompt.includes("Orchestrator Pass — After Round 1")
          ? 2
          : 3;
      return makeSuccessResponse(makeAgentOutput(agent.name, round));
    });

    const passArgs: { round: number }[] = [];
    const betweenRounds = vi.fn(
      async ({ round }: { round: number; packet: unknown }) => {
        passArgs.push({ round });
        return {
          directive: `Orchestrator Pass — After Round ${round}\n\ndirective text`,
        };
      },
    );

    const { run } = createRoundRunner({
      config,
      agents,
      backend,
      betweenRounds,
    });
    const result = await run();

    expect(result.ok).toBe(true);
    // Called after round 1 and round 2, but NOT after round 3 (last round)
    expect(betweenRounds).toHaveBeenCalledTimes(2);
    expect(passArgs[0].round).toBe(1);
    expect(passArgs[1].round).toBe(2);
  });

  it("injects the betweenRounds directive into subsequent round briefs", async () => {
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

    const betweenRounds = vi.fn(async () => ({
      directive:
        "## Orchestrator Pass — After Round 1\n\nFocus on convergence.",
    }));

    const { run } = createRoundRunner({
      config,
      agents,
      backend,
      betweenRounds,
    });
    await run();

    // Round 2 briefs should include the orchestrator directive
    const round2Briefs = briefs.slice(2);
    for (const brief of round2Briefs) {
      expect(brief).toContain("## Orchestrator Pass — After Round 1");
      expect(brief).toContain("Focus on convergence.");
    }
  });

  it("does not call betweenRounds for a single-round run", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) =>
      makeSuccessResponse(makeAgentOutput(agent.name, 1)),
    );

    const betweenRounds = vi.fn(async () => ({
      directive: "should not appear",
    }));

    const { run } = createRoundRunner({
      config,
      agents,
      backend,
      betweenRounds,
    });
    const result = await run();

    expect(result.ok).toBe(true);
    expect(betweenRounds).not.toHaveBeenCalled();
  });
});

describe("startRound resume option", () => {
  it("skips rounds before startRound", async () => {
    const config = makeConfig({ rounds: 3, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);
    const emittedRounds: number[] = [];

    const backend = makeStubBackend((_prompt, agent) => {
      const round = emittedRounds[emittedRounds.length - 1] ?? 1;
      return makeSuccessResponse(makeAgentOutput(agent.name, round));
    });

    const { emitter, run } = createRoundRunner({
      config,
      agents,
      backend,
      startRound: 2,
    });

    emitter.on("round:start", ({ round }: { round: number }) => {
      emittedRounds.push(round);
    });

    const result = await run();

    expect(result.ok).toBe(true);
    expect(emittedRounds).toEqual([2, 3]);
    expect(emittedRounds).not.toContain(1);
  });

  it("uses initialPriorPacket for the scheduler in the first executed round", async () => {
    const config = makeConfig({ rounds: 3, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const priorPacket = {
      round: 1,
      agents: ["alpha", "beta"],
      summaries: [
        {
          agent: "alpha",
          stance: "agree",
          recommendation: "go",
          objections: [],
          risks: [],
          confidence: "high" as const,
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

    const backend = makeStubBackend((_prompt, agent) =>
      makeSuccessResponse(makeAgentOutput(agent.name, 2)),
    );

    const schedulerDecisions: Array<{ round: number; selected: string[] }> = [];
    const { emitter, run } = createRoundRunner({
      config,
      agents,
      backend,
      startRound: 2,
      schedulerPolicy: "addressed-only",
      initialPriorPacket: priorPacket,
    });

    emitter.on(
      "round:start",
      ({ round, agents: selected }: { round: number; agents: string[] }) => {
        schedulerDecisions.push({ round, selected });
      },
    );

    await run();

    expect(schedulerDecisions[0]?.round).toBe(2);
    expect(schedulerDecisions[0]?.selected).toEqual(["alpha"]);
  });
});

describe("createRoundRunner per-agent backend resolution", () => {
  it("dispatches each agent through the resolver-returned adapter", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const fallback = makeStubBackend((_prompt, agent) =>
      makeSuccessResponse(makeAgentOutput(agent.name, 1)),
    );
    const alphaBackend = makeStubBackend((_prompt, agent) =>
      makeSuccessResponse(makeAgentOutput(agent.name, 1)),
    );
    const betaBackend = makeStubBackend((_prompt, agent) =>
      makeSuccessResponse(makeAgentOutput(agent.name, 1)),
    );

    const { run } = createRoundRunner({
      config,
      agents,
      backend: fallback,
      resolveBackend: (agent) =>
        agent.name === "alpha" ? alphaBackend : betaBackend,
    });

    const result = await run();

    expect(result.ok).toBe(true);
    expect(
      (alphaBackend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(1);
    expect(
      (betaBackend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(1);
    expect(
      (fallback.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(0);
  });

  it("falls back to the default backend when no resolver is given", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const backend = makeStubBackend((_prompt, agent) =>
      makeSuccessResponse(makeAgentOutput(agent.name, 1)),
    );

    const { run } = createRoundRunner({ config, agents, backend });
    await run();

    expect(
      (backend.dispatch as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(2);
  });

  it("uses each adapter's extractOutputJson and formatFailure during validation", async () => {
    const config = makeConfig({ rounds: 1, agents: ["alpha", "beta"] });
    const agents = ["alpha", "beta"].map(makeAgent);

    const alphaExtract = vi.fn((raw: string) => {
      // Custom format: "ALPHA::<agent>"
      const name = raw.split("::")[1] ?? "unknown";
      return makeAgentOutput(name, 1);
    });
    const alphaBackend: BackendAdapter = {
      wrapperName: "alpha-wrapper",
      dispatch: vi.fn(async (_prompt, agent) => ({
        ok: true,
        exitCode: 0,
        stdout: `ALPHA::${agent.name}`,
        stderr: "",
        timedOut: false,
        durationMs: 10,
      })),
      extractOutputJson: alphaExtract,
    };

    const betaBackend = makeStubBackend((_prompt, agent) =>
      makeSuccessResponse(makeAgentOutput(agent.name, 1)),
    );

    const { run } = createRoundRunner({
      config,
      agents,
      backend: betaBackend,
      resolveBackend: (agent) =>
        agent.name === "alpha" ? alphaBackend : betaBackend,
    });

    const result = await run();

    expect(result.ok).toBe(true);
    expect(alphaExtract).toHaveBeenCalledTimes(1);
  });
});
