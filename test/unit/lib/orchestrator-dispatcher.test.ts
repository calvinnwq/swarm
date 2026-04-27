import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { dispatchOrchestratorPass } from "../../../src/lib/orchestrator-dispatcher.js";
import type {
  AgentResponse,
  BackendAdapter,
} from "../../../src/backends/index.js";
import type {
  AgentDefinition,
  RoundPacket,
} from "../../../src/schemas/index.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/orchestrator-output-sample.json", import.meta.url),
);
const sampleJson = readFileSync(fixturePath, "utf-8");

const orchestratorAgent: AgentDefinition = {
  name: "orchestrator",
  description: "Test orchestrator agent",
  persona: "test persona",
  prompt: "test prompt",
  backend: "claude",
};

const minimalPacket: RoundPacket = {
  round: 1,
  agents: ["alpha", "beta"],
  summaries: [
    {
      agent: "alpha",
      stance: "lean B",
      recommendation: "ship B",
      objections: [],
      risks: ["timing"],
      confidence: "medium",
      openQuestions: ["who owns deploy?"],
    },
    {
      agent: "beta",
      stance: "lean B",
      recommendation: "ship B",
      objections: [],
      risks: ["timing"],
      confidence: "medium",
      openQuestions: [],
    },
  ],
  keyObjections: [],
  sharedRisks: ["timing"],
  openQuestions: ["who owns deploy?"],
  questionResolutions: [],
  questionResolutionLimit: 0,
  deferredQuestions: [],
};

function makeResponse(stdout: string, ok = true): AgentResponse {
  return {
    ok,
    exitCode: ok ? 0 : 1,
    stdout,
    stderr: ok ? "" : "boom",
    timedOut: false,
    durationMs: 12,
  };
}

function makeBackend(
  responses: AgentResponse[] | ((prompt: string) => AgentResponse),
): BackendAdapter & { dispatch: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn(async (prompt: string) => {
    if (typeof responses === "function") {
      return responses(prompt);
    }
    const next = responses.shift();
    if (!next) throw new Error("backend ran out of responses");
    return next;
  });
  return {
    wrapperName: "test-backend",
    dispatch,
  } as BackendAdapter & { dispatch: ReturnType<typeof vi.fn> };
}

describe("dispatchOrchestratorPass", () => {
  it("returns ok=true with the parsed orchestrator output on the success path", async () => {
    const backend = makeBackend([makeResponse(sampleJson)]);
    const result = await dispatchOrchestratorPass({
      backend,
      agent: orchestratorAgent,
      packet: minimalPacket,
      goal: "ship slice",
      decision: "pick option",
      nextRound: 2,
    });

    expect(backend.dispatch).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.directive).toMatch(/Round 2/);
      expect(result.output.questionResolutions.length).toBe(2);
      expect(result.raw.stdout).toBe(sampleJson);
    }
  });

  it("dispatches the orchestrator resolution prompt that includes intent and source packet", async () => {
    const backend = makeBackend([makeResponse(sampleJson)]);
    await dispatchOrchestratorPass({
      backend,
      agent: orchestratorAgent,
      packet: minimalPacket,
      goal: "ship slice",
      decision: "pick option",
      nextRound: 2,
    });

    const prompt = backend.dispatch.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("Orchestrator Resolution Pass");
    expect(prompt).toContain("Goal: ship slice");
    expect(prompt).toContain("Decision target: pick option");
    expect(prompt).toContain("Round 2");
    expect(prompt).toContain("who owns deploy?");
    expect(prompt).toContain("Output contract");
  });

  it("passes the agent definition and timeout through to the backend", async () => {
    const backend = makeBackend([makeResponse(sampleJson)]);
    await dispatchOrchestratorPass({
      backend,
      agent: orchestratorAgent,
      packet: minimalPacket,
      goal: null,
      decision: null,
      nextRound: 2,
      timeoutMs: 4242,
    });

    expect(backend.dispatch).toHaveBeenCalledTimes(1);
    const [, agentArg, optsArg] = backend.dispatch.mock.calls[0]!;
    expect(agentArg).toBe(orchestratorAgent);
    expect(optsArg).toEqual({ timeoutMs: 4242 });
  });

  it("returns ok=false when the backend dispatch throws", async () => {
    const dispatch = vi.fn(async () => {
      throw new Error("network down");
    });
    const backend: BackendAdapter = {
      wrapperName: "test-backend",
      dispatch,
    };

    const result = await dispatchOrchestratorPass({
      backend,
      agent: orchestratorAgent,
      packet: minimalPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/network down/);
      expect(result.raw).toBeNull();
    }
  });

  it("returns ok=false with the backend failure message when ok=false", async () => {
    const backend = makeBackend([makeResponse("ignored", false)]);
    const result = await dispatchOrchestratorPass({
      backend,
      agent: orchestratorAgent,
      packet: minimalPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/exited with code 1/);
      expect(result.raw).not.toBeNull();
    }
  });

  it("recovers when the first response is malformed and the repair returns valid JSON", async () => {
    const backend = makeBackend([
      makeResponse("not valid json"),
      makeResponse(sampleJson),
    ]);
    const result = await dispatchOrchestratorPass({
      backend,
      agent: orchestratorAgent,
      packet: minimalPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });

    expect(backend.dispatch).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.directive).toMatch(/Round 2/);
    }

    const repairPrompt = backend.dispatch.mock.calls[1]?.[0] as string;
    expect(repairPrompt).toContain("could not be accepted");
    expect(repairPrompt).toContain("not valid json");
  });

  it("returns ok=false when both the initial dispatch and the repair return malformed output", async () => {
    const backend = makeBackend([
      makeResponse("first attempt garbage"),
      makeResponse("second attempt garbage"),
    ]);
    const result = await dispatchOrchestratorPass({
      backend,
      agent: orchestratorAgent,
      packet: minimalPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });

    expect(backend.dispatch).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/extract|Schema/i);
      expect(result.error).toMatch(/attempt/);
      expect(result.raw).not.toBeNull();
    }
  });

  it("returns ok=false when the repair dispatch itself fails with ok=false", async () => {
    const backend = makeBackend([
      makeResponse("first attempt garbage"),
      makeResponse("ignored", false),
    ]);
    const result = await dispatchOrchestratorPass({
      backend,
      agent: orchestratorAgent,
      packet: minimalPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });

    expect(backend.dispatch).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/exited with code 1/);
    }
  });

  it("returns ok=false when the repair dispatch throws", async () => {
    let call = 0;
    const dispatch = vi.fn(async () => {
      call++;
      if (call === 1) return makeResponse("first garbage");
      throw new Error("repair network down");
    });
    const backend: BackendAdapter = {
      wrapperName: "test-backend",
      dispatch,
    };

    const result = await dispatchOrchestratorPass({
      backend,
      agent: orchestratorAgent,
      packet: minimalPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/repair dispatch failed/);
      expect(result.error).toMatch(/repair network down/);
    }
  });

  it("returns ok=false when the dispatched JSON parses but fails schema validation", async () => {
    const partial = JSON.stringify({ round: 2, directive: "ok" });
    const backend = makeBackend([makeResponse(partial), makeResponse(partial)]);
    const result = await dispatchOrchestratorPass({
      backend,
      agent: orchestratorAgent,
      packet: minimalPacket,
      goal: null,
      decision: null,
      nextRound: 2,
    });

    expect(backend.dispatch).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Schema/);
    }
  });
});
