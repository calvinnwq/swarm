import type { EventEmitter } from "node:events";
import type { RoundRunnerEvents } from "../lib/round-runner.js";
import { stringWidth } from "./terminal-width.js";
import {
  type Cell,
  textToCells,
  emptyCells,
  rowToString,
  diffFrames,
  emitDiff,
} from "./cells.js";

export type AgentStatus = "waiting" | "working" | "ok" | "failed" | "timed-out";

export type Phase = "seed" | "round" | "synthesis" | "done";

export interface AgentState {
  name: string;
  status: AgentStatus;
  startedAt: number | null;
  durationMs: number | null;
}

export interface RendererState {
  phase: Phase;
  currentRound: number;
  totalRounds: number;
  agents: AgentState[];
}

const STATUS_DOTS: Record<AgentStatus, string> = {
  waiting: "\u25cb", // ○
  working: "\u25cf", // ●
  ok: "\u2713", // ✓
  failed: "\u2717", // ✗
  "timed-out": "\u2717", // ✗
};

const STATUS_STYLES: Record<AgentStatus, "normal" | "bold" | "dim"> = {
  waiting: "dim",
  working: "bold",
  ok: "normal",
  failed: "bold",
  "timed-out": "bold",
};

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function padRight(text: string, width: number): string {
  const w = stringWidth(text);
  return w >= width ? text : text + " ".repeat(width - w);
}

/**
 * Build the phase banner row: `seed -> round 1 -> round 2 -> synthesis`
 * The current phase is bold, completed phases are dim, future phases are dim.
 */
export function buildBanner(state: RendererState, width: number): Cell[] {
  const phases: { label: string; active: boolean; done: boolean }[] = [];

  phases.push({
    label: "seed",
    active: state.phase === "seed",
    done: state.phase !== "seed",
  });

  for (let r = 1; r <= state.totalRounds; r++) {
    const active = state.phase === "round" && state.currentRound === r;
    const done =
      state.phase === "synthesis" ||
      state.phase === "done" ||
      (state.phase === "round" && state.currentRound > r);
    phases.push({ label: `round ${r}`, active, done });
  }

  phases.push({
    label: "synthesis",
    active: state.phase === "synthesis",
    done: state.phase === "done",
  });

  const cells: Cell[] = [...textToCells(" ", "normal")];

  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const style = p.active ? "bold" : "dim";
    cells.push(...textToCells(p.label, style));
    if (i < phases.length - 1) {
      cells.push(...textToCells(" \u2192 ", "dim")); // →
    }
  }

  // Pad or trim to width
  while (cells.length < width) {
    cells.push(...emptyCells(1));
  }

  return cells.slice(0, width);
}

/**
 * Build a separator row: `─` repeated to width.
 */
export function buildSeparator(width: number): Cell[] {
  const cells: Cell[] = [...textToCells(" ", "dim")];
  for (let i = 1; i < width; i++) {
    cells.push(...textToCells("\u2500", "dim")); // ─
  }
  return cells.slice(0, width);
}

/**
 * Build a per-agent status row.
 */
export function buildAgentRow(
  agent: AgentState,
  nameWidth: number,
  width: number,
  now: number,
): Cell[] {
  const style = STATUS_STYLES[agent.status];
  const dot = STATUS_DOTS[agent.status];
  const statusLabel = padRight(agent.status, 9);

  const elapsed =
    agent.durationMs !== null
      ? formatElapsed(agent.durationMs)
      : agent.startedAt !== null
        ? formatElapsed(now - agent.startedAt)
        : "     ";

  const cells: Cell[] = [
    ...textToCells(" ", "normal"),
    ...textToCells(padRight(agent.name, nameWidth), "normal"),
    ...textToCells("  ", "normal"),
    ...textToCells(dot, style),
    ...textToCells(" ", "normal"),
    ...textToCells(statusLabel, style),
    ...textToCells("  ", "normal"),
    ...textToCells(elapsed, "dim"),
  ];

  // Pad to width
  while (cells.length < width) {
    cells.push(...emptyCells(1));
  }

  return cells.slice(0, width);
}

/**
 * Build the full frame as a Cell[][] grid from renderer state.
 */
export function buildFrame(
  state: RendererState,
  width: number,
  now: number,
): Cell[][] {
  const nameWidth = Math.max(
    ...state.agents.map((a) => stringWidth(a.name)),
    4,
  );
  const rows: Cell[][] = [];

  rows.push(buildBanner(state, width));
  rows.push(buildSeparator(width));

  for (const agent of state.agents) {
    rows.push(buildAgentRow(agent, nameWidth, width, now));
  }

  return rows;
}

export interface LiveRendererOpts {
  write?: (data: string) => void;
  width?: number;
  now?: () => number;
  timerIntervalMs?: number;
}

export interface LiveRendererHandle {
  destroy: () => void;
}

/**
 * Attach a live, flicker-free terminal renderer to a round runner emitter.
 * Returns a handle with destroy() for cleanup.
 */
export function attachLiveRenderer(
  emitter: EventEmitter,
  opts: LiveRendererOpts = {},
): LiveRendererHandle {
  const write = opts.write ?? ((data: string) => process.stderr.write(data));
  const getWidth = () => opts.width ?? process.stderr.columns ?? 80;
  const now = opts.now ?? (() => Date.now());
  const timerIntervalMs = opts.timerIntervalMs ?? 1000;

  const state: RendererState = {
    phase: "seed",
    currentRound: 0,
    totalRounds: 0,
    agents: [],
  };

  let prevFrame: Cell[][] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  function render(): void {
    const width = getWidth();
    const frame = buildFrame(state, width, now());
    const changes = diffFrames(prevFrame, frame);

    if (prevFrame.length === 0) {
      // First render: hide cursor + draw full frame
      write("\x1b[?25l"); // hide cursor
      for (let r = 0; r < frame.length; r++) {
        write(`\x1b[${r + 1};1H`);
        write(rowToString(frame[r]));
      }
    } else if (changes.length > 0) {
      write(emitDiff(changes));
    }

    prevFrame = frame;
  }

  function startTimer(): void {
    if (timer !== null) return;
    timer = setInterval(() => {
      // Only re-render if any agents are currently working
      if (state.agents.some((a) => a.status === "working")) {
        render();
      }
    }, timerIntervalMs);
  }

  function stopTimer(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  emitter.on("round:start", (e: RoundRunnerEvents["round:start"]) => {
    state.phase = "round";
    state.currentRound = e.round;
    if (e.round === 1) {
      state.totalRounds = 0; // will be set when we know
      state.agents = e.agents.map((name) => ({
        name,
        status: "waiting" as AgentStatus,
        startedAt: null,
        durationMs: null,
      }));
    } else {
      // Reset agent states for new round
      for (const agent of state.agents) {
        agent.status = "waiting";
        agent.startedAt = null;
        agent.durationMs = null;
      }
    }
    // Infer totalRounds — it grows if we see more rounds
    if (e.round > state.totalRounds) {
      state.totalRounds = e.round;
    }
    render();
    startTimer();
  });

  emitter.on("agent:start", (e: RoundRunnerEvents["agent:start"]) => {
    const agent = state.agents.find((a) => a.name === e.agent);
    if (agent) {
      agent.status = "working";
      agent.startedAt = now();
    }
    render();
  });

  emitter.on("agent:ok", (e: RoundRunnerEvents["agent:ok"]) => {
    const agent = state.agents.find((a) => a.name === e.agent);
    if (agent) {
      agent.status = "ok";
      agent.durationMs = e.durationMs;
    }
    render();
  });

  emitter.on("agent:fail", (e: RoundRunnerEvents["agent:fail"]) => {
    const agent = state.agents.find((a) => a.name === e.agent);
    if (agent) {
      agent.status = "failed";
      agent.durationMs = e.durationMs;
    }
    render();
  });

  emitter.on("round:done", () => {
    render();
  });

  emitter.on("run:done", (e: RoundRunnerEvents["run:done"]) => {
    state.phase = "done";
    // Update totalRounds from actual result
    state.totalRounds = e.rounds.length;
    stopTimer();
    render();
    // Show cursor, move below the rendered area
    write(`\x1b[${prevFrame.length + 1};1H`);
    write("\x1b[?25h"); // show cursor
  });

  function destroy(): void {
    stopTimer();
    write("\x1b[?25h"); // show cursor
  }

  return { destroy };
}
