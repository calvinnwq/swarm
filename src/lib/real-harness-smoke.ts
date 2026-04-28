import type { ArtifactValidationResult } from "./artifact-validator.js";

/**
 * Manual real-harness smoke runner core (NGX-143 / M9-02).
 *
 * Pure logic for the manual release gate: probes the selected harness CLI,
 * shells out to the built `swarm` bin, validates resolved artifacts for
 * successful runs, normalizes the outcome, and returns a machine-readable
 * summary. The runner does not own its working directory,
 * timeouts, or stdio — those are the caller's responsibility — so this
 * function is straightforward to unit-test with stubbed deps.
 */

export type SmokeHarness = "claude" | "codex" | "opencode";

const SUPPORTED_HARNESSES: readonly SmokeHarness[] = [
  "claude",
  "codex",
  "opencode",
];

const DEFAULT_PRESET_BY_HARNESS: Record<SmokeHarness, string> = {
  claude: "product-decision",
  codex: "product-decision-codex",
  opencode: "product-decision-opencode",
};
const DEFAULT_ROUNDS = 1;
const TAIL_LIMIT = 2_048;
const TIMEOUT_EXIT_CODE = 124;
const PROBE_FAILURE_EXIT_CODE = 127;
const ARTIFACT_MISSING_EXIT_CODE = 0;

export interface RealHarnessSmokeOptions {
  /** Single harness to run for this smoke pass (claude, codex, or opencode). */
  harness: SmokeHarness;
  /** Topic argument forwarded to `swarm run`. */
  topic: string;
  /** Working directory the swarm CLI runs in (artifacts land under <cwd>/.swarm/runs). */
  cwd: string;
  /** Absolute path to the built `swarm` CLI bin (typically dist/cli.mjs). */
  cliBin: string;
  /** Preset to use; defaults to the selected harness's product-decision preset. */
  preset?: string;
  /** Number of rounds (1–3); defaults to 1 for the smoke gate. */
  rounds?: number;
  /** Hard timeout for the swarm run; passed through to spawnSync. */
  timeoutMs?: number;
}

export type FailureReason =
  | "harness-binary-missing"
  | "swarm-run-nonzero"
  | "swarm-run-timeout"
  | "artifact-dir-not-found"
  | "artifact-validation-failed";

export interface RealHarnessSmokeSummary {
  harness: SmokeHarness;
  command: readonly string[];
  exitCode: number;
  status: "ok" | "failed";
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  artifactDir: string | null;
  harnessVersion: string | null;
  failureReason: FailureReason | null;
  stdoutTail: string;
  stderrTail: string;
  validatorResult: ArtifactValidationResult | null;
}

export interface SpawnSyncResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface SpawnOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  encoding: "utf-8";
  timeout?: number;
}

export type SpawnSyncFn = (
  cmd: string,
  args: readonly string[],
  opts: SpawnOpts,
) => SpawnSyncResult;

export interface RealHarnessSmokeDeps {
  spawnSync: SpawnSyncFn;
  now: () => number;
  nowIso: () => string;
  /** Returns immediate child names of `<cwd>/.swarm/runs` (empty when missing). */
  listRunDirs: (runsDir: string) => string[];
  /** Validates artifacts for otherwise successful runs with a resolved artifactDir. */
  validateArtifacts: (artifactDir: string) => ArtifactValidationResult;
}

function tail(text: string, limit: number = TAIL_LIMIT): string {
  if (text.length <= limit) return text;
  return text.slice(text.length - limit);
}

function probeVersion(
  harness: SmokeHarness,
  spawnSync: SpawnSyncFn,
): { version: string | null; ok: boolean } {
  const result = spawnSync(harness, ["--version"], { encoding: "utf-8" });
  if (result.error || result.status !== 0) {
    return { version: null, ok: false };
  }
  const stdout = result.stdout.trim();
  if (stdout.length === 0) {
    // Some CLIs print version to stderr instead.
    const stderr = result.stderr.trim();
    return { version: stderr.length > 0 ? stderr : null, ok: true };
  }
  return { version: stdout, ok: true };
}

function buildSwarmCommand(opts: {
  cliBin: string;
  rounds: number;
  topic: string;
  preset: string;
}): string[] {
  return [
    "node",
    opts.cliBin,
    "run",
    String(opts.rounds),
    opts.topic,
    "--preset",
    opts.preset,
    "--quiet",
  ];
}

function resolveArtifactDir(
  cwd: string,
  listRunDirs: RealHarnessSmokeDeps["listRunDirs"],
): string | null {
  const runsDir = `${cwd.replace(/\/$/, "")}/.swarm/runs`;
  const entries = listRunDirs(runsDir);
  if (entries.length === 0) return null;
  // Run directory names are prefixed with an ISO-ish timestamp slug, so a
  // lexicographic sort is sufficient to surface the most recent run.
  const sorted = [...entries].sort();
  const latest = sorted[sorted.length - 1];
  return `${runsDir}/${latest}`;
}

export function runRealHarnessSmoke(
  opts: RealHarnessSmokeOptions,
  deps: RealHarnessSmokeDeps,
): RealHarnessSmokeSummary {
  if (!SUPPORTED_HARNESSES.includes(opts.harness)) {
    throw new Error(
      `harness '${opts.harness}' is not supported (use one of: ${SUPPORTED_HARNESSES.join(", ")})`,
    );
  }
  const rounds = opts.rounds ?? DEFAULT_ROUNDS;
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 3) {
    throw new Error("rounds must be between 1 and 3");
  }
  const preset = opts.preset ?? DEFAULT_PRESET_BY_HARNESS[opts.harness];

  const startedAt = deps.nowIso();
  const start = deps.now();

  const probe = probeVersion(opts.harness, deps.spawnSync);
  if (!probe.ok) {
    const finishedAt = deps.nowIso();
    const end = deps.now();
    const command = buildSwarmCommand({ ...opts, rounds, preset });
    return {
      harness: opts.harness,
      command,
      exitCode: PROBE_FAILURE_EXIT_CODE,
      status: "failed",
      durationMs: end - start,
      startedAt,
      finishedAt,
      artifactDir: null,
      harnessVersion: null,
      failureReason: "harness-binary-missing",
      stdoutTail: "",
      stderrTail: "",
      validatorResult: null,
    };
  }

  const command = buildSwarmCommand({ ...opts, rounds, preset });
  const [, ...runArgs] = command;
  const runResult = deps.spawnSync("node", runArgs, {
    cwd: opts.cwd,
    env: process.env,
    encoding: "utf-8",
    timeout: opts.timeoutMs,
  });

  const finishedAt = deps.nowIso();
  const end = deps.now();
  const artifactDir = resolveArtifactDir(opts.cwd, deps.listRunDirs);

  const timedOut = runResult.status === null && runResult.signal === "SIGTERM";
  const exitCode = timedOut
    ? TIMEOUT_EXIT_CODE
    : (runResult.status ??
      (runResult.error ? PROBE_FAILURE_EXIT_CODE : ARTIFACT_MISSING_EXIT_CODE));

  let failureReason: FailureReason | null = null;
  let status: "ok" | "failed" = "ok";
  if (timedOut) {
    failureReason = "swarm-run-timeout";
    status = "failed";
  } else if (exitCode !== 0) {
    failureReason = "swarm-run-nonzero";
    status = "failed";
  } else if (artifactDir === null) {
    failureReason = "artifact-dir-not-found";
    status = "failed";
  }

  let validatorResult: ArtifactValidationResult | null = null;
  if (artifactDir !== null && status === "ok") {
    validatorResult = deps.validateArtifacts(artifactDir);
    if (!validatorResult.ok) {
      failureReason = "artifact-validation-failed";
      status = "failed";
    }
  }

  return {
    harness: opts.harness,
    command,
    exitCode,
    status,
    durationMs: end - start,
    startedAt,
    finishedAt,
    artifactDir,
    harnessVersion: probe.version,
    failureReason,
    stdoutTail: tail(runResult.stdout),
    stderrTail: tail(runResult.stderr),
    validatorResult,
  };
}

export interface RealHarnessSmokeMatrixOptions {
  /** Harnesses to run sequentially. Order is preserved in the result. */
  harnesses: readonly SmokeHarness[];
  /** Topic argument forwarded to `swarm run` for every pass. */
  topic: string;
  /** Absolute path to the built `swarm` CLI bin (typically dist/cli.mjs). */
  cliBin: string;
  /** Optional preset override applied to every pass; default is harness-specific. */
  preset?: string;
  /** Number of rounds (1–3) for every pass; defaults to 1. */
  rounds?: number;
  /** Hard timeout in ms applied to each swarm invocation. */
  timeoutMs?: number;
  /** Returns a fresh cwd per pass so artifact dirs from different harnesses do not collide. */
  resolveCwd: (harness: SmokeHarness) => string;
}

export interface RealHarnessSmokeMatrixSummary {
  status: "ok" | "failed";
  runs: RealHarnessSmokeSummary[];
}

export function runRealHarnessSmokeMatrix(
  opts: RealHarnessSmokeMatrixOptions,
  deps: RealHarnessSmokeDeps,
): RealHarnessSmokeMatrixSummary {
  if (opts.harnesses.length === 0) {
    throw new Error("runRealHarnessSmokeMatrix requires at least one harness");
  }

  const runs: RealHarnessSmokeSummary[] = [];
  for (const harness of opts.harnesses) {
    const summary = runRealHarnessSmoke(
      {
        harness,
        topic: opts.topic,
        cliBin: opts.cliBin,
        cwd: opts.resolveCwd(harness),
        preset: opts.preset,
        rounds: opts.rounds,
        timeoutMs: opts.timeoutMs,
      },
      deps,
    );
    runs.push(summary);
  }

  const status: "ok" | "failed" = runs.every((r) => r.status === "ok")
    ? "ok"
    : "failed";

  return { status, runs };
}
