import { describe, expect, test } from "vitest";
import type { ArtifactValidatorDeps } from "../../../src/lib/artifact-validator.js";
import { validateRunArtifacts } from "../../../src/lib/artifact-validator.js";

const VALID_MANIFEST = JSON.stringify({
  runId: "run-001",
  status: "done",
  topic: "test topic",
  rounds: 2,
  backend: "claude",
  agents: ["alpha", "beta"],
  resolveMode: "off",
  startedAt: "2026-04-28T00:00:00.000Z",
  finishedAt: "2026-04-28T00:01:00.000Z",
  runDir: "/tmp/runs/test-run",
});

const VALID_CHECKPOINT = JSON.stringify({
  runId: "run-001",
  lastCompletedRound: 2,
  priorPacket: {
    round: 2,
    agents: ["alpha", "beta"],
    summaries: [],
    keyObjections: [],
    sharedRisks: [],
    openQuestions: [],
    questionResolutions: [],
    questionResolutionLimit: 0,
    deferredQuestions: [],
  },
  checkpointedAt: "2026-04-28T00:01:00.000Z",
  startedAt: "2026-04-28T00:00:00.000Z",
});

const VALID_EVENT_LINE = JSON.stringify({
  eventId: "evt-001",
  kind: "run:started",
  runId: "run-001",
  occurredAt: "2026-04-28T00:00:00.000Z",
});

const VALID_MESSAGE_LINE = JSON.stringify({
  messageId: "msg-001",
  senderId: "system",
  recipients: ["broadcast"],
  kind: "task",
  payload: {},
  deliveryStatus: "committed",
  createdAt: "2026-04-28T00:00:00.000Z",
});

const VALID_SYNTHESIS = JSON.stringify({
  topic: "test topic",
  rounds: 2,
  agents: ["alpha", "beta"],
  resolveMode: "off",
  consensus: false,
  stanceTally: [],
  topRecommendation: "rec",
  topRecommendationBasis: [],
  sharedRisks: [],
  keyObjections: [],
  openQuestions: [],
  deferredQuestions: [],
  overallConfidence: "medium",
  roundCount: 2,
  agentCount: 2,
});

function buildDeps(files: Record<string, string>): ArtifactValidatorDeps {
  return {
    readFile: (path: string) => {
      if (path in files) return files[path]!;
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    },
    fileExists: (path: string) => path in files,
  };
}

function buildValidFiles(runDir: string): Record<string, string> {
  return {
    [`${runDir}/manifest.json`]: VALID_MANIFEST,
    [`${runDir}/checkpoint.json`]: VALID_CHECKPOINT,
    [`${runDir}/events.jsonl`]: VALID_EVENT_LINE,
    [`${runDir}/messages.jsonl`]: VALID_MESSAGE_LINE,
    [`${runDir}/seed-brief.md`]: "# Seed brief",
    [`${runDir}/round-01/brief.md`]: "# Round 1 brief",
    [`${runDir}/round-01/agents/alpha.md`]: "# Alpha",
    [`${runDir}/round-01/agents/beta.md`]: "# Beta",
    [`${runDir}/round-02/brief.md`]: "# Round 2 brief",
    [`${runDir}/round-02/agents/alpha.md`]: "# Alpha",
    [`${runDir}/round-02/agents/beta.md`]: "# Beta",
    [`${runDir}/synthesis.json`]: VALID_SYNTHESIS,
    [`${runDir}/synthesis.md`]: "# Synthesis",
  };
}

describe("validateRunArtifacts", () => {
  test("returns ok=true for a complete valid 2-round run", () => {
    const runDir = "/runs/test-run";
    const result = validateRunArtifacts(
      runDir,
      buildDeps(buildValidFiles(runDir)),
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("returns error when manifest.json is missing", () => {
    const runDir = "/runs/test-run";
    const files = buildValidFiles(runDir);
    delete files[`${runDir}/manifest.json`];
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.includes("manifest.json"))).toBe(
      true,
    );
  });

  test("returns error when manifest.json is not valid JSON", () => {
    const runDir = "/runs/test-run";
    const files = {
      ...buildValidFiles(runDir),
      [`${runDir}/manifest.json`]: "not json{",
    };
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.includes("manifest.json"))).toBe(
      true,
    );
  });

  test("returns error when manifest.json fails schema validation", () => {
    const runDir = "/runs/test-run";
    const files = {
      ...buildValidFiles(runDir),
      [`${runDir}/manifest.json`]: JSON.stringify({ runId: "run-001" }),
    };
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.includes("manifest.json"))).toBe(
      true,
    );
  });

  test("returns error when checkpoint.json is missing", () => {
    const runDir = "/runs/test-run";
    const files = buildValidFiles(runDir);
    delete files[`${runDir}/checkpoint.json`];
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.includes("checkpoint.json"))).toBe(
      true,
    );
  });

  test("returns error when checkpoint.json fails schema validation", () => {
    const runDir = "/runs/test-run";
    const files = {
      ...buildValidFiles(runDir),
      [`${runDir}/checkpoint.json`]: JSON.stringify({ runId: "run-001" }),
    };
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.includes("checkpoint.json"))).toBe(
      true,
    );
  });

  test("returns error when events.jsonl contains a malformed JSON line", () => {
    const runDir = "/runs/test-run";
    const files = {
      ...buildValidFiles(runDir),
      [`${runDir}/events.jsonl`]: VALID_EVENT_LINE + "\nnot-json",
    };
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.includes("events.jsonl"))).toBe(
      true,
    );
  });

  test("returns error when events.jsonl has a line that fails RunEventSchema", () => {
    const runDir = "/runs/test-run";
    const badEvent = JSON.stringify({
      eventId: "e1",
      kind: "unknown-kind",
      runId: "run-001",
      occurredAt: "2026-04-28T00:00:00.000Z",
    });
    const files = {
      ...buildValidFiles(runDir),
      [`${runDir}/events.jsonl`]: badEvent,
    };
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.includes("events.jsonl"))).toBe(
      true,
    );
  });

  test("returns error when messages.jsonl contains a malformed JSON line", () => {
    const runDir = "/runs/test-run";
    const files = {
      ...buildValidFiles(runDir),
      [`${runDir}/messages.jsonl`]: "not-json",
    };
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.includes("messages.jsonl"))).toBe(
      true,
    );
  });

  test("returns error when seed-brief.md is missing", () => {
    const runDir = "/runs/test-run";
    const files = buildValidFiles(runDir);
    delete files[`${runDir}/seed-brief.md`];
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.includes("seed-brief.md"))).toBe(
      true,
    );
  });

  test("returns error when a round brief is missing based on manifest rounds", () => {
    const runDir = "/runs/test-run";
    const files = buildValidFiles(runDir);
    delete files[`${runDir}/round-02/brief.md`];
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.includes("round-02"))).toBe(true);
  });

  test("returns error when a round agent artifact is missing based on manifest agents", () => {
    const runDir = "/runs/test-run";
    const files = buildValidFiles(runDir);
    delete files[`${runDir}/round-02/agents/beta.md`];
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.path.includes("round-02/agents/beta.md")),
    ).toBe(true);
  });

  test("uses checkpoint agent results when validating round agent artifacts", () => {
    const runDir = "/runs/test-run";
    const checkpoint = JSON.parse(VALID_CHECKPOINT) as Record<string, unknown>;
    checkpoint["completedRoundResults"] = [
      {
        round: 1,
        agentResults: [
          { agent: "alpha", ok: false, output: null, error: "failed" },
        ],
        packet: checkpoint["priorPacket"],
      },
      {
        round: 2,
        agentResults: [
          { agent: "beta", ok: false, output: null, error: "failed" },
        ],
        packet: checkpoint["priorPacket"],
      },
    ];
    const files = buildValidFiles(runDir);
    delete files[`${runDir}/round-01/agents/beta.md`];
    delete files[`${runDir}/round-02/agents/alpha.md`];
    files[`${runDir}/checkpoint.json`] = JSON.stringify(checkpoint);
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(true);
  });

  test("falls back to manifest agents when checkpoint agent results are empty", () => {
    const runDir = "/runs/test-run";
    const checkpoint = JSON.parse(VALID_CHECKPOINT) as Record<string, unknown>;
    checkpoint["completedRoundResults"] = [
      {
        round: 1,
        agentResults: [],
        packet: checkpoint["priorPacket"],
      },
      {
        round: 2,
        agentResults: [],
        packet: checkpoint["priorPacket"],
      },
    ];
    const files = buildValidFiles(runDir);
    delete files[`${runDir}/round-02/agents/beta.md`];
    files[`${runDir}/checkpoint.json`] = JSON.stringify(checkpoint);
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.path.includes("round-02/agents/beta.md")),
    ).toBe(true);
  });

  test("uses completed round packet agents when checkpoint round results are absent", () => {
    const runDir = "/runs/test-run";
    const checkpoint = JSON.parse(VALID_CHECKPOINT) as Record<string, unknown>;
    checkpoint["completedRoundPackets"] = [
      {
        round: 1,
        agents: ["alpha"],
        summaries: [],
        keyObjections: [],
        sharedRisks: [],
        openQuestions: [],
        questionResolutions: [],
        questionResolutionLimit: 0,
        deferredQuestions: [],
      },
      {
        round: 2,
        agents: ["beta"],
        summaries: [],
        keyObjections: [],
        sharedRisks: [],
        openQuestions: [],
        questionResolutions: [],
        questionResolutionLimit: 0,
        deferredQuestions: [],
      },
    ];
    const files = buildValidFiles(runDir);
    delete files[`${runDir}/round-01/agents/beta.md`];
    delete files[`${runDir}/round-02/agents/alpha.md`];
    files[`${runDir}/checkpoint.json`] = JSON.stringify(checkpoint);
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(true);
  });

  test("returns error when synthesis.json fails schema validation when present", () => {
    const runDir = "/runs/test-run";
    const files = {
      ...buildValidFiles(runDir),
      [`${runDir}/synthesis.json`]: JSON.stringify({ topic: "test" }),
    };
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.includes("synthesis.json"))).toBe(
      true,
    );
  });

  test("returns error when manifest runId does not match checkpoint runId", () => {
    const runDir = "/runs/test-run";
    const checkpoint = JSON.parse(VALID_CHECKPOINT) as Record<string, unknown>;
    checkpoint["runId"] = "different-run-id";
    const files = {
      ...buildValidFiles(runDir),
      [`${runDir}/checkpoint.json`]: JSON.stringify(checkpoint),
    };
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.message.toLowerCase().includes("runid")),
    ).toBe(true);
  });

  test("collects all errors rather than stopping at first failure", () => {
    const runDir = "/runs/test-run";
    const files = buildValidFiles(runDir);
    delete files[`${runDir}/seed-brief.md`];
    delete files[`${runDir}/round-01/brief.md`];
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  test("returns error when synthesis artifacts are missing for a completed run", () => {
    const runDir = "/runs/test-run";
    const files = buildValidFiles(runDir);
    delete files[`${runDir}/synthesis.json`];
    delete files[`${runDir}/synthesis.md`];
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.includes("synthesis.json"))).toBe(
      true,
    );
    expect(result.errors.some((e) => e.path.includes("synthesis.md"))).toBe(
      true,
    );
  });

  test("skips synthesis validation for an in-progress run when synthesis is absent", () => {
    const runDir = "/runs/test-run";
    const manifest = JSON.parse(VALID_MANIFEST) as Record<string, unknown>;
    manifest["status"] = "running";
    delete manifest["finishedAt"];
    const files: Record<string, string> = {
      ...buildValidFiles(runDir),
      [`${runDir}/manifest.json`]: JSON.stringify(manifest),
    };
    delete files[`${runDir}/synthesis.json`];
    delete files[`${runDir}/synthesis.md`];
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(true);
  });

  test("uses last completed round for non-completed run artifact checks", () => {
    const runDir = "/runs/test-run";
    const manifest = JSON.parse(VALID_MANIFEST) as Record<string, unknown>;
    manifest["status"] = "running";
    manifest["rounds"] = 3;
    delete manifest["finishedAt"];
    const checkpoint = JSON.parse(VALID_CHECKPOINT) as Record<string, unknown>;
    checkpoint["lastCompletedRound"] = 1;
    const files: Record<string, string> = {
      ...buildValidFiles(runDir),
      [`${runDir}/manifest.json`]: JSON.stringify(manifest),
      [`${runDir}/checkpoint.json`]: JSON.stringify(checkpoint),
    };
    delete files[`${runDir}/round-02/brief.md`];
    delete files[`${runDir}/round-02/agents/alpha.md`];
    delete files[`${runDir}/round-02/agents/beta.md`];
    delete files[`${runDir}/synthesis.json`];
    delete files[`${runDir}/synthesis.md`];
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(true);
  });

  test("skips round checks when manifest is missing (no rounds to iterate)", () => {
    const runDir = "/runs/test-run";
    const files = buildValidFiles(runDir);
    delete files[`${runDir}/manifest.json`];
    delete files[`${runDir}/round-01/brief.md`];
    delete files[`${runDir}/round-02/brief.md`];
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(false);
    // manifest error present, but NOT round errors (because manifest didn't parse)
    expect(result.errors.some((e) => e.path.includes("manifest.json"))).toBe(
      true,
    );
    expect(result.errors.every((e) => !e.path.includes("round-"))).toBe(true);
  });

  test("accepts multiple valid events in events.jsonl", () => {
    const runDir = "/runs/test-run";
    const secondEvent = JSON.stringify({
      eventId: "evt-002",
      kind: "round:started",
      runId: "run-001",
      occurredAt: "2026-04-28T00:00:01.000Z",
      roundNumber: 1,
    });
    const files = {
      ...buildValidFiles(runDir),
      [`${runDir}/events.jsonl`]: VALID_EVENT_LINE + "\n" + secondEvent,
    };
    const result = validateRunArtifacts(runDir, buildDeps(files));
    expect(result.ok).toBe(true);
  });
});
