import { describe, expect, it } from "vitest";
import { RunManifestSchema } from "../../../src/schemas/index.js";

const valid = {
  topic: "sample topic",
  rounds: 2,
  preset: null,
  agents: ["alpha", "beta"],
  resolveMode: "kody" as const,
  startedAt: "2026-04-15T01:23:45.000Z",
  runDir: "/tmp/.swarm/runs/20260415-012345-sample-topic",
};

describe("RunManifestSchema", () => {
  it("accepts a minimal manifest with required fields", () => {
    const parsed = RunManifestSchema.parse(valid);
    expect(parsed.topic).toBe("sample topic");
    expect(parsed.preset).toBeNull();
    expect(parsed.finishedAt).toBeUndefined();
  });

  it("accepts finishedAt and a preset name", () => {
    const parsed = RunManifestSchema.parse({
      ...valid,
      preset: "default",
      finishedAt: "2026-04-15T01:30:00.000Z",
    });
    expect(parsed.preset).toBe("default");
    expect(parsed.finishedAt).toBe("2026-04-15T01:30:00.000Z");
  });

  it("rejects an unknown resolveMode", () => {
    const result = RunManifestSchema.safeParse({
      ...valid,
      resolveMode: "majority",
    });
    expect(result.success).toBe(false);
  });

  it("rejects rounds < 1", () => {
    expect(RunManifestSchema.safeParse({ ...valid, rounds: 0 }).success).toBe(
      false,
    );
  });
});
