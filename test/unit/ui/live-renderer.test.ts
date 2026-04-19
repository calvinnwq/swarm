import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  buildBanner,
  buildSeparator,
  buildAgentRow,
  buildFrame,
  attachLiveRenderer,
  type RendererState,
  type AgentState,
} from "../../../src/ui/live-renderer.js";
import { rowToString } from "../../../src/ui/cells.js";

/* ──────────── helpers ──────────── */

/** Strip ANSI escape sequences for plain text comparison */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function makeState(overrides: Partial<RendererState> = {}): RendererState {
  return {
    phase: "round",
    currentRound: 1,
    totalRounds: 2,
    agents: [
      { name: "product-manager", status: "working", startedAt: 1000, durationMs: null },
      { name: "principal-engineer", status: "waiting", startedAt: null, durationMs: null },
    ],
    ...overrides,
  };
}

/* ──────────── buildBanner ──────────── */

describe("buildBanner", () => {
  it("shows all phases with current phase emphasized", () => {
    const state = makeState({ phase: "round", currentRound: 1, totalRounds: 2 });
    const row = buildBanner(state, 60);
    const text = stripAnsi(rowToString(row));
    expect(text).toContain("seed");
    expect(text).toContain("round 1");
    expect(text).toContain("round 2");
    expect(text).toContain("synthesis");
    expect(text).toContain("\u2192"); // →
  });

  it("pads to the given width", () => {
    const state = makeState({ totalRounds: 1 });
    const row = buildBanner(state, 80);
    expect(row.length).toBe(80);
  });

  it("trims to width if banner exceeds it", () => {
    const state = makeState({ totalRounds: 10 });
    const row = buildBanner(state, 30);
    expect(row.length).toBe(30);
  });

  it("marks seed as bold when phase is seed", () => {
    const state = makeState({ phase: "seed" });
    const row = buildBanner(state, 60);
    // The seed text cells should be bold
    const seedStart = row.findIndex(
      (c) => c.char === "s" && c.style === "bold",
    );
    expect(seedStart).toBeGreaterThanOrEqual(0);
  });

  it("marks synthesis as bold when phase is synthesis", () => {
    const state = makeState({ phase: "synthesis" });
    const row = buildBanner(state, 60);
    const synthStart = row.findIndex(
      (c) => c.char === "s" && c.style === "bold",
    );
    expect(synthStart).toBeGreaterThanOrEqual(0);
  });
});

/* ──────────── buildSeparator ──────────── */

describe("buildSeparator", () => {
  it("creates a row of dim separator chars", () => {
    const row = buildSeparator(40);
    expect(row.length).toBe(40);
    // Most cells should be ─
    const dashCount = row.filter((c) => c.char === "\u2500").length;
    expect(dashCount).toBeGreaterThan(30);
  });

  it("all cells are dim style", () => {
    const row = buildSeparator(20);
    for (const cell of row) {
      expect(cell.style).toBe("dim");
    }
  });
});

/* ──────────── buildAgentRow ──────────── */

describe("buildAgentRow", () => {
  it("shows agent name and working status with dot", () => {
    const agent: AgentState = {
      name: "product-manager",
      status: "working",
      startedAt: 1000,
      durationMs: null,
    };
    const row = buildAgentRow(agent, 20, 60, 35_000);
    const text = stripAnsi(rowToString(row));
    expect(text).toContain("product-manager");
    expect(text).toContain("\u25cf"); // ●
    expect(text).toContain("working");
    expect(text).toContain("00:34"); // 35000 - 1000 = 34s
  });

  it("shows ok status with checkmark and final duration", () => {
    const agent: AgentState = {
      name: "orchestrator",
      status: "ok",
      startedAt: 0,
      durationMs: 12_500,
    };
    const row = buildAgentRow(agent, 20, 60, 99999);
    const text = stripAnsi(rowToString(row));
    expect(text).toContain("\u2713"); // ✓
    expect(text).toContain("ok");
    expect(text).toContain("00:12");
  });

  it("shows failed status with cross mark", () => {
    const agent: AgentState = {
      name: "critic",
      status: "failed",
      startedAt: 0,
      durationMs: 5_000,
    };
    const row = buildAgentRow(agent, 20, 60, 99999);
    const text = stripAnsi(rowToString(row));
    expect(text).toContain("\u2717"); // ✗
    expect(text).toContain("failed");
    expect(text).toContain("00:05");
  });

  it("shows waiting status with no elapsed time", () => {
    const agent: AgentState = {
      name: "analyst",
      status: "waiting",
      startedAt: null,
      durationMs: null,
    };
    const row = buildAgentRow(agent, 20, 60, 99999);
    const text = stripAnsi(rowToString(row));
    expect(text).toContain("\u25cb"); // ○
    expect(text).toContain("waiting");
    expect(text).not.toMatch(/\d\d:\d\d/);
  });

  it("pads to the given width", () => {
    const agent: AgentState = {
      name: "a",
      status: "ok",
      startedAt: 0,
      durationMs: 0,
    };
    const row = buildAgentRow(agent, 5, 80, 0);
    expect(row.length).toBe(80);
  });
});

/* ──────────── buildFrame ──────────── */

describe("buildFrame", () => {
  it("produces banner + separator + one row per agent", () => {
    const state = makeState();
    const frame = buildFrame(state, 60, 5000);
    // 1 banner + 1 separator + 2 agents = 4 rows
    expect(frame.length).toBe(4);
  });

  it("all rows have the same width", () => {
    const state = makeState();
    const frame = buildFrame(state, 60, 5000);
    for (const row of frame) {
      expect(row.length).toBe(60);
    }
  });

  it("handles single agent", () => {
    const state = makeState({
      agents: [
        { name: "solo", status: "working", startedAt: 0, durationMs: null },
      ],
    });
    const frame = buildFrame(state, 60, 5000);
    expect(frame.length).toBe(3); // banner + separator + 1 agent
  });
});

/* ──────────── attachLiveRenderer ──────────── */

describe("attachLiveRenderer", () => {
  let emitter: EventEmitter;
  let output: string;
  let writeFn: (data: string) => void;

  beforeEach(() => {
    emitter = new EventEmitter();
    output = "";
    writeFn = (data: string) => {
      output += data;
    };
  });

  it("renders on round:start", () => {
    const handle = attachLiveRenderer(emitter, {
      write: writeFn,
      width: 60,
      now: () => 0,
    });

    emitter.emit("round:start", {
      round: 1,
      agents: ["product-manager", "principal-engineer"],
    });

    expect(output).toContain("\x1b[?25l"); // cursor hidden
    expect(stripAnsi(output)).toContain("round 1");
    expect(stripAnsi(output)).toContain("product-manager");
    handle.destroy();
  });

  it("updates agent status on agent:start", () => {
    const handle = attachLiveRenderer(emitter, {
      write: writeFn,
      width: 60,
      now: () => 1000,
    });

    emitter.emit("round:start", {
      round: 1,
      agents: ["product-manager"],
    });

    output = "";
    emitter.emit("agent:start", { round: 1, agent: "product-manager" });

    // Should have rendered diff with working status
    const plain = stripAnsi(output);
    expect(plain).toContain("working");
    handle.destroy();
  });

  it("updates agent status on agent:ok", () => {
    const handle = attachLiveRenderer(emitter, {
      write: writeFn,
      width: 60,
      now: () => 1000,
    });

    emitter.emit("round:start", {
      round: 1,
      agents: ["product-manager"],
    });
    emitter.emit("agent:start", { round: 1, agent: "product-manager" });
    output = "";

    emitter.emit("agent:ok", {
      round: 1,
      agent: "product-manager",
      output: {},
      durationMs: 5000,
    });

    const plain = stripAnsi(output);
    expect(plain).toContain("ok");
    handle.destroy();
  });

  it("updates agent status on agent:fail", () => {
    const handle = attachLiveRenderer(emitter, {
      write: writeFn,
      width: 60,
      now: () => 1000,
    });

    emitter.emit("round:start", {
      round: 1,
      agents: ["product-manager"],
    });
    output = "";

    emitter.emit("agent:fail", {
      round: 1,
      agent: "product-manager",
      error: "timeout",
      durationMs: 120000,
    });

    const plain = stripAnsi(output);
    expect(plain).toContain("failed");
    handle.destroy();
  });

  it("shows cursor and cleans up on run:done", () => {
    const handle = attachLiveRenderer(emitter, {
      write: writeFn,
      width: 60,
      now: () => 0,
    });

    emitter.emit("round:start", {
      round: 1,
      agents: ["product-manager"],
    });
    output = "";

    emitter.emit("run:done", {
      rounds: [{ round: 1, agentResults: [], packet: {} }],
      ok: true,
    });

    expect(output).toContain("\x1b[?25h"); // cursor shown
    handle.destroy();
  });

  it("destroy shows cursor", () => {
    output = "";
    const handle = attachLiveRenderer(emitter, {
      write: writeFn,
      width: 60,
      now: () => 0,
    });

    handle.destroy();
    expect(output).toContain("\x1b[?25h");
  });

  it("resets agent states between rounds", () => {
    const handle = attachLiveRenderer(emitter, {
      write: writeFn,
      width: 60,
      now: () => 1000,
    });

    emitter.emit("round:start", {
      round: 1,
      agents: ["product-manager"],
    });
    emitter.emit("agent:ok", {
      round: 1,
      agent: "product-manager",
      output: {},
      durationMs: 5000,
    });

    output = "";
    emitter.emit("round:start", {
      round: 2,
      agents: ["product-manager"],
    });

    // After new round start, agent should be waiting again
    const plain = stripAnsi(output);
    expect(plain).toContain("waiting");
    handle.destroy();
  });

  it("handles timer for elapsed time updates", () => {
    vi.useFakeTimers();
    let time = 0;

    const handle = attachLiveRenderer(emitter, {
      write: writeFn,
      width: 60,
      now: () => time,
      timerIntervalMs: 100,
    });

    emitter.emit("round:start", {
      round: 1,
      agents: ["product-manager"],
    });
    emitter.emit("agent:start", { round: 1, agent: "product-manager" });

    output = "";
    time = 5000;
    vi.advanceTimersByTime(100);

    // Timer should have triggered a re-render (diff output contains changed cells)
    expect(output.length).toBeGreaterThan(0);

    handle.destroy();
    vi.useRealTimers();
  });
});
