import { describe, expect, it, vi } from "vitest";
import { OutputRouter } from "../../../src/lib/output-router.js";
import type { OutputTarget } from "../../../src/lib/output-router.js";
import type { RoundResult } from "../../../src/lib/round-runner.js";
import type { SynthesisResult } from "../../../src/lib/synthesis.js";

function makeTarget(): OutputTarget & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    init: vi.fn(() => {
      calls.push("init");
    }),
    writeRound: vi.fn((_r: RoundResult, _b: string) => {
      calls.push("writeRound");
    }),
    writeSynthesis: vi.fn((_s: SynthesisResult) => {
      calls.push("writeSynthesis");
    }),
    finalize: vi.fn((_f: string, _s: "done" | "failed") => {
      calls.push("finalize");
    }),
  };
}

const stubRound = {
  round: 1,
  agentResults: [],
  packet: {},
} as unknown as RoundResult;
const stubSynthesis = { json: {}, markdown: "" } as unknown as SynthesisResult;

describe("OutputRouter", () => {
  it("calls init on all targets", async () => {
    const a = makeTarget();
    const b = makeTarget();
    const router = new OutputRouter([a, b]);
    await router.init();
    expect(a.init).toHaveBeenCalledOnce();
    expect(b.init).toHaveBeenCalledOnce();
  });

  it("calls writeRound on all targets with the same arguments", async () => {
    const a = makeTarget();
    const b = makeTarget();
    const router = new OutputRouter([a, b]);
    await router.writeRound(stubRound, "brief text");
    expect(a.writeRound).toHaveBeenCalledWith(stubRound, "brief text");
    expect(b.writeRound).toHaveBeenCalledWith(stubRound, "brief text");
  });

  it("calls writeSynthesis on all targets", async () => {
    const a = makeTarget();
    const b = makeTarget();
    const router = new OutputRouter([a, b]);
    await router.writeSynthesis(stubSynthesis);
    expect(a.writeSynthesis).toHaveBeenCalledWith(stubSynthesis);
    expect(b.writeSynthesis).toHaveBeenCalledWith(stubSynthesis);
  });

  it("calls finalize on all targets with the timestamp and status", async () => {
    const a = makeTarget();
    const b = makeTarget();
    const router = new OutputRouter([a, b]);
    await router.finalize("2026-04-23T00:00:00.000Z", "done");
    expect(a.finalize).toHaveBeenCalledWith("2026-04-23T00:00:00.000Z", "done");
    expect(b.finalize).toHaveBeenCalledWith("2026-04-23T00:00:00.000Z", "done");
  });

  it("calls targets in order", async () => {
    const order: string[] = [];
    const a: OutputTarget = {
      init: vi.fn(() => {
        order.push("a:init");
      }),
      writeRound: vi.fn(),
      writeSynthesis: vi.fn(),
      finalize: vi.fn(),
    };
    const b: OutputTarget = {
      init: vi.fn(() => {
        order.push("b:init");
      }),
      writeRound: vi.fn(),
      writeSynthesis: vi.fn(),
      finalize: vi.fn(),
    };
    const router = new OutputRouter([a, b]);
    await router.init();
    expect(order).toEqual(["a:init", "b:init"]);
  });

  it("works with zero targets", async () => {
    const router = new OutputRouter([]);
    await expect(router.init()).resolves.toBeUndefined();
    await expect(router.writeRound(stubRound, "")).resolves.toBeUndefined();
    await expect(router.writeSynthesis(stubSynthesis)).resolves.toBeUndefined();
    await expect(router.finalize("ts", "done")).resolves.toBeUndefined();
  });

  it("awaits async targets before calling the next", async () => {
    const order: string[] = [];
    const a: OutputTarget = {
      init: vi.fn(async () => {
        await Promise.resolve();
        order.push("a");
      }),
      writeRound: vi.fn(),
      writeSynthesis: vi.fn(),
      finalize: vi.fn(),
    };
    const b: OutputTarget = {
      init: vi.fn(() => {
        order.push("b");
      }),
      writeRound: vi.fn(),
      writeSynthesis: vi.fn(),
      finalize: vi.fn(),
    };
    const router = new OutputRouter([a, b]);
    await router.init();
    expect(order).toEqual(["a", "b"]);
  });
});
