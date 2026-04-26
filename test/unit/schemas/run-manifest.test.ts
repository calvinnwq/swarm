import { describe, expect, it } from "vitest";
import { RunManifestSchema } from "../../../src/schemas/index.js";

const valid = {
  runId: "00000000-0000-0000-0000-000000000001",
  status: "running" as const,
  topic: "sample topic",
  rounds: 2,
  backend: "claude" as const,
  preset: null,
  agents: ["alpha", "beta"],
  resolveMode: "orchestrator" as const,
  startedAt: "2026-04-15T01:23:45.000Z",
  runDir: "/tmp/.swarm/runs/20260415-012345-sample-topic",
};

describe("RunManifestSchema", () => {
  it("accepts a minimal manifest with required fields", () => {
    const parsed = RunManifestSchema.parse(valid);
    expect(parsed.topic).toBe("sample topic");
    expect(parsed.preset).toBeNull();
    expect(parsed.finishedAt).toBeUndefined();
    expect(parsed.runId).toBe("00000000-0000-0000-0000-000000000001");
    expect(parsed.status).toBe("running");
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

  it("accepts done and failed statuses", () => {
    expect(RunManifestSchema.parse({ ...valid, status: "done" }).status).toBe(
      "done",
    );
    expect(RunManifestSchema.parse({ ...valid, status: "failed" }).status).toBe(
      "failed",
    );
    expect(
      RunManifestSchema.parse({ ...valid, status: "pending" }).status,
    ).toBe("pending");
  });

  it("rejects an unknown status", () => {
    expect(
      RunManifestSchema.safeParse({ ...valid, status: "crashed" }).success,
    ).toBe(false);
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

  it("accepts an agentRuntimes array of resolved runtimes", () => {
    const parsed = RunManifestSchema.parse({
      ...valid,
      agentRuntimes: [
        {
          agentName: "alpha",
          harness: "claude",
          model: "sonnet-4-7",
          source: { harness: "agent.harness", model: "agent.model" },
        },
        {
          agentName: "beta",
          harness: "codex",
          model: null,
          source: { harness: "agent.backend", model: "harness-default" },
        },
      ],
    });
    expect(parsed.agentRuntimes).toHaveLength(2);
    expect(parsed.agentRuntimes?.[0]?.harness).toBe("claude");
    expect(parsed.agentRuntimes?.[1]?.model).toBeNull();
  });

  it("rejects an agentRuntimes entry with an unknown harness", () => {
    const result = RunManifestSchema.safeParse({
      ...valid,
      agentRuntimes: [
        {
          agentName: "alpha",
          harness: "phantom",
          model: null,
          source: { harness: "agent.harness", model: "harness-default" },
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
