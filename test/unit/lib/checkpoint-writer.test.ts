import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { CheckpointWriter } from "../../../src/lib/checkpoint-writer.js";
import type { RunCheckpoint } from "../../../src/schemas/run-checkpoint.js";

const validPacket = {
  round: 1,
  agents: ["alpha", "beta"],
  summaries: [],
  keyObjections: [],
  sharedRisks: [],
  openQuestions: [],
  questionResolutions: [],
  questionResolutionLimit: 3,
  deferredQuestions: [],
};

function makeCheckpoint(overrides: Partial<RunCheckpoint> = {}): RunCheckpoint {
  return {
    runId: "00000000-0000-0000-0000-000000000001",
    lastCompletedRound: 1,
    priorPacket: validPacket,
    checkpointedAt: "2026-04-24T10:00:00.000Z",
    ...overrides,
  };
}

let testDir: string;
let runDir: string;
let writer: CheckpointWriter;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `checkpoint-writer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  runDir = join(testDir, "run-001");
  mkdirSync(runDir, { recursive: true });
  writer = new CheckpointWriter(runDir);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("CheckpointWriter", () => {
  describe("checkpointPath", () => {
    it("points to checkpoint.json inside runDir", () => {
      expect(writer.checkpointPath).toBe(join(runDir, "checkpoint.json"));
    });
  });

  describe("write", () => {
    it("creates checkpoint.json in runDir", () => {
      writer.write(makeCheckpoint());
      expect(existsSync(writer.checkpointPath)).toBe(true);
    });

    it("writes valid JSON content", () => {
      const checkpoint = makeCheckpoint({ lastCompletedRound: 2 });
      writer.write(checkpoint);
      const raw = readFileSync(writer.checkpointPath, "utf-8");
      const parsed = JSON.parse(raw) as RunCheckpoint;
      expect(parsed.lastCompletedRound).toBe(2);
      expect(parsed.runId).toBe(checkpoint.runId);
    });

    it("overwrites the previous checkpoint on subsequent calls", () => {
      writer.write(makeCheckpoint({ lastCompletedRound: 1 }));
      writer.write(makeCheckpoint({ lastCompletedRound: 2 }));
      const raw = readFileSync(writer.checkpointPath, "utf-8");
      expect(JSON.parse(raw).lastCompletedRound).toBe(2);
    });

    it("does not leave a .tmp file after write", () => {
      writer.write(makeCheckpoint());
      expect(existsSync(join(runDir, "checkpoint.json.tmp"))).toBe(false);
    });

    it("persists orchestratorDirective when provided", () => {
      writer.write(
        makeCheckpoint({ orchestratorDirective: "Focus on risks." }),
      );
      const raw = readFileSync(writer.checkpointPath, "utf-8");
      expect(JSON.parse(raw).orchestratorDirective).toBe("Focus on risks.");
    });

    it("omits orchestratorDirective when not provided", () => {
      writer.write(makeCheckpoint());
      const raw = readFileSync(writer.checkpointPath, "utf-8");
      expect(JSON.parse(raw).orchestratorDirective).toBeUndefined();
    });

    it("throws ZodError for invalid checkpoint data", () => {
      expect(() =>
        writer.write({ ...makeCheckpoint(), lastCompletedRound: 0 }),
      ).toThrow();
    });
  });

  describe("read", () => {
    it("returns null when no checkpoint file exists", () => {
      expect(writer.read()).toBeNull();
    });

    it("returns the written checkpoint after write", () => {
      const checkpoint = makeCheckpoint({ lastCompletedRound: 3 });
      writer.write(checkpoint);
      const result = writer.read();
      expect(result).not.toBeNull();
      expect(result!.lastCompletedRound).toBe(3);
    });

    it("returns null when the file contains invalid JSON", () => {
      writeFileSync(writer.checkpointPath, "not-json");
      expect(writer.read()).toBeNull();
    });

    it("returns null when the file contains invalid checkpoint structure", () => {
      writeFileSync(
        writer.checkpointPath,
        JSON.stringify({ runId: "x", lastCompletedRound: -1 }),
      );
      expect(writer.read()).toBeNull();
    });

    it("returns a fully parsed RunCheckpoint with correct types", () => {
      const checkpoint = makeCheckpoint({ orchestratorDirective: "Review." });
      writer.write(checkpoint);
      const result = writer.read();
      expect(result?.orchestratorDirective).toBe("Review.");
      expect(result?.priorPacket.agents).toEqual(["alpha", "beta"]);
    });

    it("round-trips multiple writes and reads the last written checkpoint", () => {
      writer.write(makeCheckpoint({ lastCompletedRound: 1 }));
      writer.write(makeCheckpoint({ lastCompletedRound: 2 }));
      writer.write(makeCheckpoint({ lastCompletedRound: 3 }));
      expect(writer.read()?.lastCompletedRound).toBe(3);
    });
  });
});
