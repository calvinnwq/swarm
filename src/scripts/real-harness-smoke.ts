/**
 * Manual real-harness smoke gate (NGX-143 / M9-02).
 *
 * Thin CLI around `runRealHarnessSmokeMatrix` that the release engineer runs by
 * hand against real harness CLIs (claude, codex, opencode). Not part of
 * `pnpm test` or `pnpm test:e2e` — auth/credentials/network must come from the
 * operator.
 *
 * Default behavior:
 *   - mkdtemp a fresh working dir per harness pass under os.tmpdir()
 *   - resolve dist/cli.mjs next to this script after `pnpm build`
 *   - print one matrix JSON object on stdout, exit 0 when every pass is ok,
 *     exit 1 when any pass failed (run failed or artifacts missing)
 *
 * Run via `pnpm smoke:real --harness claude --topic "alpha"` for a single
 * harness, or `--harness claude,codex` for a sequential mixed run.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError } from "commander";
import {
  runRealHarnessSmokeMatrix,
  type RealHarnessSmokeDeps,
  type RealHarnessSmokeMatrixSummary,
  type SmokeHarness,
} from "../lib/real-harness-smoke.js";

const SUPPORTED_HARNESSES: readonly SmokeHarness[] = [
  "claude",
  "codex",
  "opencode",
];

function defaultCliBin(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // After `pnpm build`, this script lives at dist/scripts/real-harness-smoke.mjs
  // and the CLI bin lives at dist/cli.mjs.
  return resolvePath(here, "..", "cli.mjs");
}

function parseHarnessList(value: string): readonly SmokeHarness[] {
  const seen = new Set<SmokeHarness>();
  const ordered: SmokeHarness[] = [];
  const raw = value.split(",").map((token) => token.trim());
  for (const token of raw) {
    if (token === "") {
      throw new InvalidArgumentError(
        "--harness must not contain empty entries",
      );
    }
    if (!SUPPORTED_HARNESSES.includes(token as SmokeHarness)) {
      throw new InvalidArgumentError(
        `--harness entries must be one of: ${SUPPORTED_HARNESSES.join(", ")} (got '${token}')`,
      );
    }
    const harness = token as SmokeHarness;
    if (!seen.has(harness)) {
      seen.add(harness);
      ordered.push(harness);
    }
  }
  if (ordered.length === 0) {
    throw new InvalidArgumentError("--harness requires at least one entry");
  }
  return ordered;
}

function parseRounds(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3) {
    throw new InvalidArgumentError("--rounds must be an integer in [1,3]");
  }
  return parsed;
}

function parseTimeout(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(
      "--timeout-ms must be a positive integer (milliseconds)",
    );
  }
  return parsed;
}

function listRunDirs(runsDir: string): string[] {
  try {
    const entries = readdirSync(runsDir);
    return entries.filter((name) => {
      try {
        return statSync(join(runsDir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function buildDeps(): RealHarnessSmokeDeps {
  return {
    spawnSync: (cmd, args, opts) => {
      const result = spawnSync(cmd, [...args], {
        cwd: opts.cwd,
        env: opts.env,
        encoding: opts.encoding,
        timeout: opts.timeout,
      });
      return {
        status: result.status,
        signal: result.signal,
        stdout: typeof result.stdout === "string" ? result.stdout : "",
        stderr: typeof result.stderr === "string" ? result.stderr : "",
        error: result.error,
      };
    },
    now: () => Date.now(),
    nowIso: () => new Date().toISOString(),
    listRunDirs,
  };
}

interface CliOptions {
  harnesses: readonly SmokeHarness[];
  topic: string;
  preset?: string;
  rounds?: number;
  keepArtifacts: boolean;
  baseDir?: string;
  cliBin?: string;
  timeoutMs?: number;
}

function runFromOptions(options: CliOptions): RealHarnessSmokeMatrixSummary {
  const cliBin = options.cliBin ? resolvePath(options.cliBin) : defaultCliBin();
  const baseDir = options.baseDir ? resolvePath(options.baseDir) : tmpdir();
  const ownedDirs: string[] = [];

  const resolveCwd = (harness: SmokeHarness): string => {
    const dir = mkdtempSync(join(baseDir, `swarm-real-smoke-${harness}-`));
    ownedDirs.push(dir);
    return dir;
  };

  try {
    return runRealHarnessSmokeMatrix(
      {
        harnesses: options.harnesses,
        topic: options.topic,
        cliBin,
        preset: options.preset,
        rounds: options.rounds,
        timeoutMs: options.timeoutMs,
        resolveCwd,
      },
      buildDeps(),
    );
  } finally {
    if (!options.keepArtifacts) {
      for (const dir of ownedDirs) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup; do not mask the smoke result.
        }
      }
    }
  }
}

const program = new Command();
program
  .name("real-harness-smoke")
  .description(
    "Manual release gate: shell out to the built swarm CLI against one or more real harnesses and capture a normalized summary. NOT a CI test — auth/credentials must be configured locally.",
  )
  .requiredOption(
    "--harness <list>",
    `comma-separated harnesses to drive sequentially (${SUPPORTED_HARNESSES.join(" | ")}); duplicates are deduped`,
    parseHarnessList,
  )
  .requiredOption("--topic <text>", "topic forwarded to swarm run")
  .option(
    "--preset <name>",
    "preset to use for every pass (default: harness-specific bundled preset)",
  )
  .option("--rounds <n>", "rounds 1–3 (default: 1)", parseRounds)
  .option(
    "--keep-artifacts",
    "do not delete the per-harness temp working directories after the runs",
    false,
  )
  .option(
    "--base-dir <path>",
    "base directory under which per-harness mkdtemps are created (default: os tmpdir)",
  )
  .option(
    "--cli-bin <path>",
    "explicit path to dist/cli.mjs (default: dist/cli.mjs sibling)",
  )
  .option(
    "--timeout-ms <n>",
    "hard timeout for each swarm run in ms",
    parseTimeout,
  )
  .action((options: Record<string, unknown>) => {
    const summary = runFromOptions({
      harnesses: options.harness as readonly SmokeHarness[],
      topic: options.topic as string,
      preset: options.preset as string | undefined,
      rounds: options.rounds as number | undefined,
      keepArtifacts: options.keepArtifacts === true,
      baseDir: options.baseDir as string | undefined,
      cliBin: options.cliBin as string | undefined,
      timeoutMs: options.timeoutMs as number | undefined,
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exit(summary.status === "ok" ? 0 : 1);
  });

try {
  await program.parseAsync();
} catch (err) {
  process.stderr.write(
    `\n  real-harness-smoke: ${err instanceof Error ? err.message : String(err)}\n\n`,
  );
  process.exit(2);
}
