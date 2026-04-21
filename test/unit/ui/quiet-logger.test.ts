import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { attachQuietLogger } from "../../../src/ui/quiet-logger.js";
import type { AgentResult } from "../../../src/lib/round-runner.js";

function setup() {
  const emitter = new EventEmitter();
  const lines: string[] = [];
  attachQuietLogger(emitter, { write: (line) => lines.push(line) });
  return { emitter, lines };
}

describe("attachQuietLogger", () => {
  it("logs round:start", () => {
    const { emitter, lines } = setup();
    emitter.emit("round:start", {
      round: 1,
      agents: ["product-manager", "principal-engineer"],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      "[round 1] start agents=product-manager,principal-engineer\n",
    );
  });

  it("logs agent:start", () => {
    const { emitter, lines } = setup();
    emitter.emit("agent:start", { round: 1, agent: "product-manager" });
    expect(lines[0]).toBe("[round 1] product-manager dispatching\n");
  });

  it("logs agent:ok with stance and confidence", () => {
    const { emitter, lines } = setup();
    emitter.emit("agent:ok", {
      round: 1,
      agent: "product-manager",
      output: { stance: "approve", confidence: "high" },
      durationMs: 3456,
    });
    expect(lines[0]).toBe(
      "[round 1] product-manager ok stance=approve confidence=high 3.5s\n",
    );
  });

  it("logs agent:fail with error", () => {
    const { emitter, lines } = setup();
    emitter.emit("agent:fail", {
      round: 2,
      agent: "principal-engineer",
      error: "timed out",
      durationMs: 120000,
    });
    expect(lines[0]).toBe(
      "[round 2] principal-engineer FAILED timed out 120.0s\n",
    );
  });

  it("logs round:done with ok/fail counts", () => {
    const { emitter, lines } = setup();
    const agentResults: AgentResult[] = [
      {
        agent: "product-manager",
        ok: true,
        output: null,
        raw: null,
        error: null,
      },
      {
        agent: "principal-engineer",
        ok: false,
        output: null,
        raw: null,
        error: "err",
      },
      { agent: "orchestrator", ok: true, output: null, raw: null, error: null },
    ];
    emitter.emit("round:done", { round: 1, packet: {}, agentResults });
    expect(lines[0]).toBe("[round 1] done ok=2 fail=1\n");
  });

  it("logs run:done success", () => {
    const { emitter, lines } = setup();
    emitter.emit("run:done", { ok: true, rounds: [{}, {}] });
    expect(lines[0]).toBe("[run] complete rounds=2\n");
  });

  it("logs run:done failure", () => {
    const { emitter, lines } = setup();
    emitter.emit("run:done", { ok: false, rounds: [{}] });
    expect(lines[0]).toBe("[run] failed rounds=1\n");
  });

  it("logs full event sequence for a 2-agent 1-round run", () => {
    const { emitter, lines } = setup();
    emitter.emit("round:start", {
      round: 1,
      agents: ["product-manager", "principal-engineer"],
    });
    emitter.emit("agent:start", { round: 1, agent: "product-manager" });
    emitter.emit("agent:start", { round: 1, agent: "principal-engineer" });
    emitter.emit("agent:ok", {
      round: 1,
      agent: "product-manager",
      output: { stance: "approve", confidence: "high" },
      durationMs: 2000,
    });
    emitter.emit("agent:ok", {
      round: 1,
      agent: "principal-engineer",
      output: { stance: "approve", confidence: "medium" },
      durationMs: 3000,
    });
    emitter.emit("round:done", {
      round: 1,
      packet: {},
      agentResults: [
        {
          agent: "product-manager",
          ok: true,
          output: null,
          raw: null,
          error: null,
        },
        {
          agent: "principal-engineer",
          ok: true,
          output: null,
          raw: null,
          error: null,
        },
      ],
    });
    emitter.emit("run:done", { ok: true, rounds: [{}] });
    expect(lines).toHaveLength(7);
    expect(lines[0]).toMatch(/\[round 1\] start/);
    expect(lines[lines.length - 1]).toMatch(/\[run\] complete/);
  });
});
