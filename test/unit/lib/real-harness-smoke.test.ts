import { describe, expect, it, vi } from "vitest";
import {
  runRealHarnessSmoke,
  runRealHarnessSmokeMatrix,
  type RealHarnessSmokeDeps,
  type SmokeHarness,
  type SpawnSyncFn,
  type SpawnSyncResult,
} from "../../../src/lib/real-harness-smoke.js";
import type { ArtifactValidationResult } from "../../../src/lib/artifact-validator.js";

interface SpawnInvocation {
  cmd: string;
  args: readonly string[];
  cwd?: string;
  timeout?: number;
}

interface MakeDepsOpts {
  spawn?: (invocation: SpawnInvocation, callIndex: number) => SpawnSyncResult;
  runDirs?: string[];
  start?: number;
  end?: number;
  startedIso?: string;
  finishedIso?: string;
  validateArtifacts?: (artifactDir: string) => ArtifactValidationResult;
}

function makeDeps(opts: MakeDepsOpts = {}): {
  deps: RealHarnessSmokeDeps;
  invocations: SpawnInvocation[];
} {
  const invocations: SpawnInvocation[] = [];
  let callIndex = 0;
  const spawnSync: SpawnSyncFn = (cmd, args, spawnOpts) => {
    const invocation: SpawnInvocation = {
      cmd,
      args,
      cwd: spawnOpts?.cwd,
      timeout: spawnOpts?.timeout,
    };
    invocations.push(invocation);
    const result = opts.spawn?.(invocation, callIndex) ?? {
      status: 0,
      signal: null,
      stdout: "",
      stderr: "",
    };
    callIndex += 1;
    return result;
  };
  const nowMock = vi.fn();
  nowMock.mockReturnValueOnce(opts.start ?? 1_000);
  nowMock.mockReturnValueOnce(opts.end ?? 4_500);
  // any subsequent calls return end timestamp
  nowMock.mockReturnValue(opts.end ?? 4_500);
  const nowIsoMock = vi.fn();
  nowIsoMock.mockReturnValueOnce(opts.startedIso ?? "2026-04-28T00:00:00.000Z");
  nowIsoMock.mockReturnValueOnce(
    opts.finishedIso ?? "2026-04-28T00:00:03.500Z",
  );
  nowIsoMock.mockReturnValue(opts.finishedIso ?? "2026-04-28T00:00:03.500Z");
  const deps: RealHarnessSmokeDeps = {
    spawnSync,
    now: nowMock,
    nowIso: nowIsoMock,
    listRunDirs: vi.fn(() => opts.runDirs ?? ["20260428T000003Z-some-topic"]),
    validateArtifacts:
      opts.validateArtifacts ?? vi.fn(() => ({ ok: true, errors: [] })),
  };
  return { deps, invocations };
}

const baseOpts = {
  topic: "Some topic",
  cwd: "/tmp/swarm-real-smoke-test",
  cliBin: "/repo/dist/cli.mjs",
};

describe("runRealHarnessSmoke", () => {
  it("returns ok summary for a successful claude single-harness run", () => {
    const { deps, invocations } = makeDeps({
      spawn: (invocation, index) => {
        if (index === 0) {
          // claude --version probe
          expect(invocation.cmd).toBe("claude");
          expect(invocation.args).toEqual(["--version"]);
          return {
            status: 0,
            signal: null,
            stdout: "1.2.3 (anthropic-claude)\n",
            stderr: "",
          };
        }
        if (index === 1) {
          // swarm run via node
          expect(invocation.cmd).toBe("node");
          expect(invocation.args).toEqual([
            "/repo/dist/cli.mjs",
            "run",
            "1",
            "Some topic",
            "--preset",
            "product-decision",
            "--quiet",
          ]);
          expect(invocation.cwd).toBe("/tmp/swarm-real-smoke-test");
          return {
            status: 0,
            signal: null,
            stdout: "[run] complete rounds=1\n",
            stderr: "",
          };
        }
        throw new Error(`Unexpected spawn call ${index}`);
      },
    });

    const summary = runRealHarnessSmoke(
      { ...baseOpts, harness: "claude" },
      deps,
    );

    expect(summary.status).toBe("ok");
    expect(summary.exitCode).toBe(0);
    expect(summary.harness).toBe("claude");
    expect(summary.harnessVersion).toBe("1.2.3 (anthropic-claude)");
    expect(summary.failureReason).toBeNull();
    expect(summary.command).toEqual([
      "node",
      "/repo/dist/cli.mjs",
      "run",
      "1",
      "Some topic",
      "--preset",
      "product-decision",
      "--quiet",
    ]);
    expect(summary.durationMs).toBe(3_500);
    expect(summary.startedAt).toBe("2026-04-28T00:00:00.000Z");
    expect(summary.finishedAt).toBe("2026-04-28T00:00:03.500Z");
    expect(summary.artifactDir).toBe(
      "/tmp/swarm-real-smoke-test/.swarm/runs/20260428T000003Z-some-topic",
    );
    expect(invocations).toHaveLength(2);
  });

  it("uses product-decision-codex preset for a codex single-harness run and probes codex --version", () => {
    const { deps, invocations } = makeDeps({
      spawn: (_invocation, index) => {
        if (index === 0) {
          return {
            status: 0,
            signal: null,
            stdout: "codex 0.4.1\n",
            stderr: "",
          };
        }
        return {
          status: 0,
          signal: null,
          stdout: "",
          stderr: "",
        };
      },
    });

    const summary = runRealHarnessSmoke(
      { ...baseOpts, harness: "codex" },
      deps,
    );

    expect(invocations[0]?.cmd).toBe("codex");
    expect(invocations[0]?.args).toEqual(["--version"]);
    expect(summary.harnessVersion).toBe("codex 0.4.1");
    expect(summary.command).toEqual([
      "node",
      "/repo/dist/cli.mjs",
      "run",
      "1",
      "Some topic",
      "--preset",
      "product-decision-codex",
      "--quiet",
    ]);
    expect(summary.status).toBe("ok");
  });

  it("uses product-decision-opencode preset for an opencode single-harness run and probes opencode --version", () => {
    const { deps, invocations } = makeDeps({
      spawn: (_invocation, index) => {
        if (index === 0) {
          return {
            status: 0,
            signal: null,
            stdout: "opencode 0.9.0\n",
            stderr: "",
          };
        }
        return {
          status: 0,
          signal: null,
          stdout: "",
          stderr: "",
        };
      },
    });

    const summary = runRealHarnessSmoke(
      { ...baseOpts, harness: "opencode" },
      deps,
    );

    expect(invocations[0]?.cmd).toBe("opencode");
    expect(invocations[0]?.args).toEqual(["--version"]);
    expect(summary.harnessVersion).toBe("opencode 0.9.0");
    expect(summary.command).toEqual([
      "node",
      "/repo/dist/cli.mjs",
      "run",
      "1",
      "Some topic",
      "--preset",
      "product-decision-opencode",
      "--quiet",
    ]);
    expect(summary.status).toBe("ok");
  });

  it("flags harness-binary-missing when the version probe fails to spawn", () => {
    const enoent = Object.assign(new Error("spawn claude ENOENT"), {
      code: "ENOENT",
    });
    const { deps } = makeDeps({
      spawn: (_invocation, index) => {
        if (index === 0) {
          return {
            status: null,
            signal: null,
            stdout: "",
            stderr: "",
            error: enoent,
          };
        }
        throw new Error("swarm run should not be invoked when probe fails");
      },
    });

    const summary = runRealHarnessSmoke(
      { ...baseOpts, harness: "claude" },
      deps,
    );

    expect(summary.status).toBe("failed");
    expect(summary.failureReason).toBe("harness-binary-missing");
    expect(summary.exitCode).not.toBe(0);
    expect(summary.harnessVersion).toBeNull();
    expect(summary.artifactDir).toBeNull();
  });

  it("flags swarm-run-nonzero when the swarm CLI exits with a non-zero status", () => {
    const { deps } = makeDeps({
      spawn: (_invocation, index) => {
        if (index === 0) {
          return {
            status: 0,
            signal: null,
            stdout: "1.0.0\n",
            stderr: "",
          };
        }
        return {
          status: 1,
          signal: null,
          stdout: "",
          stderr: "[round 1] dispatch FAILED auth\n",
        };
      },
    });

    const summary = runRealHarnessSmoke(
      { ...baseOpts, harness: "claude" },
      deps,
    );

    expect(summary.status).toBe("failed");
    expect(summary.exitCode).toBe(1);
    expect(summary.failureReason).toBe("swarm-run-nonzero");
    expect(summary.stderrTail).toContain("auth");
    // artifact dir may still be discoverable from a partial run
    expect(summary.artifactDir).toBe(
      "/tmp/swarm-real-smoke-test/.swarm/runs/20260428T000003Z-some-topic",
    );
  });

  it("forwards timeoutMs to swarm run and flags process timeouts", () => {
    const { deps, invocations } = makeDeps({
      spawn: (_invocation, index) => {
        if (index === 0) {
          return {
            status: 0,
            signal: null,
            stdout: "1.0.0\n",
            stderr: "",
          };
        }
        return {
          status: null,
          signal: "SIGTERM",
          stdout: "",
          stderr: "",
        };
      },
    });

    const summary = runRealHarnessSmoke(
      { ...baseOpts, harness: "claude", timeoutMs: 250 },
      deps,
    );

    expect(summary.status).toBe("failed");
    expect(summary.failureReason).toBe("swarm-run-timeout");
    expect(summary.exitCode).toBe(124);
    expect(invocations[1]?.timeout).toBe(250);
    expect(invocations[1]?.args).toContain("--timeout-ms");
    expect(invocations[1]?.args).toContain("250");
    expect(summary.command).toContain("--timeout-ms");
    expect(summary.command).toContain("250");
  });

  it("flags artifact-dir-not-found when the swarm exit code is 0 but no run dir was created", () => {
    const { deps } = makeDeps({
      spawn: (_invocation, index) => {
        if (index === 0) {
          return {
            status: 0,
            signal: null,
            stdout: "1.0.0\n",
            stderr: "",
          };
        }
        return {
          status: 0,
          signal: null,
          stdout: "",
          stderr: "",
        };
      },
      runDirs: [],
    });

    const summary = runRealHarnessSmoke(
      { ...baseOpts, harness: "claude" },
      deps,
    );

    expect(summary.status).toBe("failed");
    expect(summary.failureReason).toBe("artifact-dir-not-found");
    expect(summary.exitCode).toBe(0);
    expect(summary.artifactDir).toBeNull();
  });

  it("picks the most recent run dir when multiple are present (lexicographic tail)", () => {
    const { deps } = makeDeps({
      spawn: (_invocation, index) => {
        if (index === 0) {
          return {
            status: 0,
            signal: null,
            stdout: "1.0.0\n",
            stderr: "",
          };
        }
        return {
          status: 0,
          signal: null,
          stdout: "",
          stderr: "",
        };
      },
      runDirs: [
        "20260427T120000Z-old",
        "20260428T000003Z-new",
        "20260427T230000Z-mid",
      ],
    });

    const summary = runRealHarnessSmoke(
      { ...baseOpts, harness: "claude" },
      deps,
    );

    expect(summary.artifactDir).toBe(
      "/tmp/swarm-real-smoke-test/.swarm/runs/20260428T000003Z-new",
    );
  });

  it("respects custom rounds and preset and adds them to the swarm command", () => {
    const { deps, invocations } = makeDeps({
      spawn: () => ({
        status: 0,
        signal: null,
        stdout: "1.0.0\n",
        stderr: "",
      }),
    });

    const summary = runRealHarnessSmoke(
      {
        ...baseOpts,
        harness: "claude",
        rounds: 2,
        preset: "release-readiness",
      },
      deps,
    );

    expect(summary.command).toEqual([
      "node",
      "/repo/dist/cli.mjs",
      "run",
      "2",
      "Some topic",
      "--preset",
      "release-readiness",
      "--quiet",
    ]);
    expect(invocations[1]?.args).toEqual([
      "/repo/dist/cli.mjs",
      "run",
      "2",
      "Some topic",
      "--preset",
      "release-readiness",
      "--quiet",
    ]);
  });

  it("rejects unsupported harnesses with a clear error", () => {
    const { deps } = makeDeps();
    expect(() =>
      runRealHarnessSmoke(
        // @ts-expect-error -- intentionally invalid harness
        { ...baseOpts, harness: "rovo" },
        deps,
      ),
    ).toThrowError(/harness 'rovo' is not supported/);
  });

  it("honors an explicit preset override even for codex/opencode", () => {
    const { deps, invocations } = makeDeps({
      spawn: () => ({ status: 0, signal: null, stdout: "v\n", stderr: "" }),
    });

    runRealHarnessSmoke(
      { ...baseOpts, harness: "codex", preset: "custom-codex" },
      deps,
    );
    expect(invocations[1]?.args).toContain("custom-codex");
    expect(invocations[1]?.args).not.toContain("product-decision-codex");
  });

  it("rejects rounds outside 1-3", () => {
    const { deps } = makeDeps();
    expect(() =>
      runRealHarnessSmoke({ ...baseOpts, harness: "claude", rounds: 4 }, deps),
    ).toThrowError(/rounds must be between 1 and 3/);
  });

  it("includes validatorResult in summary when run succeeds and artifact dir is found", () => {
    const { deps } = makeDeps({
      spawn: (_invocation, index) => {
        if (index === 0)
          return { status: 0, signal: null, stdout: "1.0.0\n", stderr: "" };
        return { status: 0, signal: null, stdout: "", stderr: "" };
      },
      validateArtifacts: vi.fn(() => ({ ok: true, errors: [] })),
    });

    const summary = runRealHarnessSmoke(
      { ...baseOpts, harness: "claude" },
      deps,
    );

    expect(summary.validatorResult).toEqual({ ok: true, errors: [] });
  });

  it("passes the resolved artifactDir to validateArtifacts", () => {
    const validateArtifacts = vi.fn(() => ({ ok: true, errors: [] }));
    const { deps } = makeDeps({
      spawn: () => ({ status: 0, signal: null, stdout: "1.0.0\n", stderr: "" }),
      validateArtifacts,
    });

    runRealHarnessSmoke({ ...baseOpts, harness: "claude" }, deps);

    expect(validateArtifacts).toHaveBeenCalledWith(
      "/tmp/swarm-real-smoke-test/.swarm/runs/20260428T000003Z-some-topic",
    );
  });

  it("sets status=failed and failureReason=artifact-validation-failed when validator fails", () => {
    const { deps } = makeDeps({
      spawn: () => ({ status: 0, signal: null, stdout: "1.0.0\n", stderr: "" }),
      validateArtifacts: vi.fn(() => ({
        ok: false,
        errors: [{ path: "/run/manifest.json", message: "file not found" }],
      })),
    });

    const summary = runRealHarnessSmoke(
      { ...baseOpts, harness: "claude" },
      deps,
    );

    expect(summary.status).toBe("failed");
    expect(summary.failureReason).toBe("artifact-validation-failed");
    expect(summary.validatorResult?.ok).toBe(false);
  });

  it("sets validatorResult=null and skips validation when artifactDir is not found", () => {
    const validateArtifacts = vi.fn(() => ({ ok: true, errors: [] }));
    const { deps } = makeDeps({
      spawn: (_invocation, index) => {
        if (index === 0)
          return { status: 0, signal: null, stdout: "1.0.0\n", stderr: "" };
        return { status: 0, signal: null, stdout: "", stderr: "" };
      },
      runDirs: [],
      validateArtifacts,
    });

    const summary = runRealHarnessSmoke(
      { ...baseOpts, harness: "claude" },
      deps,
    );

    expect(summary.validatorResult).toBeNull();
    expect(validateArtifacts).not.toHaveBeenCalled();
  });

  it("captures stdout and stderr tails from the swarm run", () => {
    const longStdout = `${"a\n".repeat(80)}final-line\n`;
    const longStderr = `${"e\n".repeat(80)}fatal: boom\n`;
    const { deps } = makeDeps({
      spawn: (_invocation, index) => {
        if (index === 0) {
          return { status: 0, signal: null, stdout: "v\n", stderr: "" };
        }
        return {
          status: 0,
          signal: null,
          stdout: longStdout,
          stderr: longStderr,
        };
      },
    });

    const summary = runRealHarnessSmoke(
      { ...baseOpts, harness: "claude" },
      deps,
    );

    expect(summary.stdoutTail.endsWith("final-line\n")).toBe(true);
    expect(summary.stderrTail).toContain("fatal: boom");
    // tails should be capped at a reasonable size
    expect(summary.stdoutTail.length).toBeLessThanOrEqual(2_048);
    expect(summary.stderrTail.length).toBeLessThanOrEqual(2_048);
  });
});

describe("runRealHarnessSmokeMatrix", () => {
  const matrixBaseOpts = {
    topic: "Matrix topic",
    cliBin: "/repo/dist/cli.mjs",
  };

  it("wraps a single-harness run in a matrix summary with status ok", () => {
    const { deps, invocations } = makeDeps({
      spawn: (_invocation, index) => {
        if (index === 0) {
          return { status: 0, signal: null, stdout: "1.0.0\n", stderr: "" };
        }
        return { status: 0, signal: null, stdout: "", stderr: "" };
      },
    });

    const summary = runRealHarnessSmokeMatrix(
      {
        ...matrixBaseOpts,
        harnesses: ["claude"],
        resolveCwd: () => "/tmp/swarm-real-smoke-claude",
      },
      deps,
    );

    expect(summary.status).toBe("ok");
    expect(summary.runs).toHaveLength(1);
    expect(summary.runs[0]?.harness).toBe("claude");
    expect(summary.runs[0]?.status).toBe("ok");
    expect(invocations).toHaveLength(2);
  });

  it("runs claude then codex in order, isolating each pass under its own cwd", () => {
    const cwds: Record<SmokeHarness, string> = {
      claude: "/tmp/smoke-claude",
      codex: "/tmp/smoke-codex",
      opencode: "/tmp/smoke-opencode",
    };
    const { deps, invocations } = makeDeps({
      spawn: () => ({ status: 0, signal: null, stdout: "v\n", stderr: "" }),
      runDirs: ["20260428T000003Z-some-topic"],
    });

    const summary = runRealHarnessSmokeMatrix(
      {
        ...matrixBaseOpts,
        harnesses: ["claude", "codex"],
        resolveCwd: (harness) => cwds[harness],
      },
      deps,
    );

    expect(summary.status).toBe("ok");
    expect(summary.runs.map((r) => r.harness)).toEqual(["claude", "codex"]);

    // 4 spawns: claude probe, claude swarm, codex probe, codex swarm
    expect(invocations).toHaveLength(4);
    expect(invocations[0]?.cmd).toBe("claude");
    expect(invocations[1]?.cwd).toBe("/tmp/smoke-claude");
    expect(invocations[2]?.cmd).toBe("codex");
    expect(invocations[3]?.cwd).toBe("/tmp/smoke-codex");

    expect(summary.runs[0]?.command).toEqual([
      "node",
      "/repo/dist/cli.mjs",
      "run",
      "1",
      "Matrix topic",
      "--preset",
      "product-decision",
      "--quiet",
    ]);
    expect(summary.runs[1]?.command).toEqual([
      "node",
      "/repo/dist/cli.mjs",
      "run",
      "1",
      "Matrix topic",
      "--preset",
      "product-decision-codex",
      "--quiet",
    ]);
  });

  it("runs opencode through the bundled product-decision-opencode preset", () => {
    const { deps, invocations } = makeDeps({
      spawn: () => ({
        status: 0,
        signal: null,
        stdout: "opencode 0.9.0\n",
        stderr: "",
      }),
    });

    const summary = runRealHarnessSmokeMatrix(
      {
        ...matrixBaseOpts,
        harnesses: ["opencode"],
        resolveCwd: () => "/tmp/smoke-opencode",
      },
      deps,
    );

    expect(summary.status).toBe("ok");
    expect(invocations[0]?.cmd).toBe("opencode");
    expect(invocations[1]?.args).toContain("product-decision-opencode");
    expect(invocations[1]?.args).not.toContain("--backend");
  });

  it("returns failed status when any pass fails but still records every run", () => {
    const { deps } = makeDeps({
      spawn: (_invocation, index) => {
        if (index === 0) {
          // claude probe ok
          return { status: 0, signal: null, stdout: "1.0.0\n", stderr: "" };
        }
        if (index === 1) {
          // claude swarm ok
          return { status: 0, signal: null, stdout: "", stderr: "" };
        }
        if (index === 2) {
          // codex probe fails (missing binary)
          const enoent = Object.assign(new Error("spawn codex ENOENT"), {
            code: "ENOENT",
          });
          return {
            status: null,
            signal: null,
            stdout: "",
            stderr: "",
            error: enoent,
          };
        }
        throw new Error(`Unexpected spawn call ${index}`);
      },
    });

    const summary = runRealHarnessSmokeMatrix(
      {
        ...matrixBaseOpts,
        harnesses: ["claude", "codex"],
        resolveCwd: (harness) => `/tmp/smoke-${harness}`,
      },
      deps,
    );

    expect(summary.status).toBe("failed");
    expect(summary.runs).toHaveLength(2);
    expect(summary.runs[0]?.status).toBe("ok");
    expect(summary.runs[1]?.status).toBe("failed");
    expect(summary.runs[1]?.failureReason).toBe("harness-binary-missing");
  });

  it("rejects an empty harness list", () => {
    const { deps } = makeDeps();
    expect(() =>
      runRealHarnessSmokeMatrix(
        {
          ...matrixBaseOpts,
          harnesses: [],
          resolveCwd: () => "/tmp/whatever",
        },
        deps,
      ),
    ).toThrowError(/at least one harness/);
  });

  it("propagates an explicit preset override to every pass", () => {
    const { deps, invocations } = makeDeps({
      spawn: () => ({ status: 0, signal: null, stdout: "v\n", stderr: "" }),
    });

    runRealHarnessSmokeMatrix(
      {
        ...matrixBaseOpts,
        harnesses: ["claude", "codex"],
        preset: "release-readiness",
        resolveCwd: (harness) => `/tmp/smoke-${harness}`,
      },
      deps,
    );

    // both swarm runs (indices 1 and 3) should use the override preset
    expect(invocations[1]?.args).toContain("release-readiness");
    expect(invocations[3]?.args).toContain("release-readiness");
    expect(invocations[1]?.args).not.toContain("product-decision");
    expect(invocations[3]?.args).not.toContain("product-decision-codex");
  });
});
