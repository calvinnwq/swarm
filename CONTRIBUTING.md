# Contributing to swarm

Thanks for hacking on swarm! This guide covers the dev loop, the release flow, the manual real-harness smoke gate, and a map of the source tree.

For end-user docs (install, presets, agents, artifacts), see [README.md](README.md). The README is the authoritative user-facing spec — when alpha behavior is ambiguous, README contracts win.

## Prerequisites

- Node ≥ 20 (Node 24 LTS pinned in `.nvmrc` — run `nvm use`)
- pnpm 10
- For real-harness work: at least one of `claude`, `codex`, or `opencode` on `PATH` and authenticated.

## Setup

```bash
pnpm install
pnpm build
pnpm link --global   # exposes the `swarm` bin from dist/cli.mjs
```

Don't edit anything under `dist/` by hand. The `build` script bundles `src/` and copies bundled agents/presets into `dist/agents/bundled/` and `dist/presets/bundled/`. Adding a new bundled agent or preset means dropping a YAML file into `src/agents/bundled/` or `src/presets/bundled/` — no extra wiring needed.

## Commands

```bash
pnpm build           # tsdown bundle + copy bundled agents/presets
pnpm dev             # tsdown --watch
pnpm test            # vitest unit tests (test/unit/**)
pnpm test:e2e        # builds, then vitest with vitest.e2e.config.ts (test/e2e/**)
pnpm smoke           # builds, runs only test/e2e/smoke.test.ts (golden-path verification)
pnpm smoke:real      # builds, then runs real harness CLIs manually (not CI)
pnpm typecheck       # tsc -p tsconfig.typecheck.json --noEmit
pnpm lint            # eslint src
pnpm format          # prettier --write src test
pnpm format:check    # prettier --check src test
```

Run a single test file: `vitest run test/unit/path/to/file.test.ts` (add `--config vitest.e2e.config.ts` for e2e). Filter by name: `vitest run -t "pattern"`.

The `.no-mistakes.yaml` workflow runs `pnpm test` for tests and `pnpm lint && pnpm typecheck && pnpm format:check` for lint — keep all three green together when changing `src/`.

`pnpm smoke` is the repeatable alpha verification: it builds, runs `swarm doctor` against the built CLI, and exercises the `--preset product-decision` flow end to end with a stubbed backend. Use it before cutting a release or after touching bundled agents, presets, or CLI wiring. For Codex-specific coverage, run `pnpm build && vitest run --config vitest.e2e.config.ts test/e2e/codex-backend.test.ts` or the full `pnpm test:e2e`.

## Conventions

- **ESM only.** Imports use `.js` extensions even for `.ts` source (TS `moduleResolution: "bundler"`). Don't drop the extension.
- **Strict TS.** `tsconfig.json` is strict. Prefer Zod-inferred types (`z.infer<typeof Schema>`) over hand-rolled interfaces for any data that crosses the disk/wire boundary.
- **No defensive code for impossible states.** Validation lives at boundaries (CLI parsing, schema decode, harness probe) — internal callers can trust resolved values.
- **Tests are split.** Unit tests under `test/unit/` mirror `src/`. End-to-end tests under `test/e2e/` build the CLI and shell out to it.
- **Diagnostics convention.** `swarm doctor` is the canonical diagnostic surface. New diagnostics should match its exit-code convention: `0` ok, `1` checks failed (with actionable per-check messages), `2` internal command error.

## Releases

GitHub releases are managed by Release Please. After release-driving Conventional Commits land on `main`, the `release-please` workflow opens or updates a Release Please PR with the next version and a `CHANGELOG.md` entry. Merging that PR updates `package.json`, writes the changelog, creates the git tag, and creates the GitHub Release.

Use:

- `feat:`, `fix:`, `deps:` for changes that should appear in the next release.
- `docs:`, `test:`, `refactor:`, `chore:`, or project-specific scopes for non-release work.

npm publishing is not part of the current release workflow.

## Real-harness smoke gate (`pnpm smoke:real`)

`pnpm smoke:real` is a **manual release gate**. It runs the built `swarm` CLI against one or more real harness CLIs and prints a normalized JSON summary. It is intentionally **not** part of `pnpm test`, `pnpm test:e2e`, or CI — those use stubbed harnesses for speed and determinism.

Reach for it when you want to verify a release candidate end-to-end against actual harness binaries.

### Prerequisites

- Target harness CLIs are on `PATH` and authenticated (`claude auth login`, `codex login`, `opencode auth login`).
- The repo has been built (the script runs `pnpm build` for you).

### Quickstart

```bash
# Single harness — uses bundled product-decision (Claude default)
pnpm smoke:real --harness claude --topic "release readiness check"

# Mixed harnesses, run sequentially with isolated working dirs
pnpm smoke:real --harness claude,codex --topic "release readiness check"

# OpenCode — uses bundled product-decision-opencode preset
pnpm smoke:real --harness opencode --topic "release readiness check"
```

By default each harness uses its bundled preset (`product-decision` for claude, `product-decision-codex` for codex, `product-decision-opencode` for opencode).

### Flags

- `--preset <name>` overrides every pass.
- `--rounds <1-3>` bumps rounds (default `1`).
- `--timeout-ms <n>` forwards a per-agent/orchestrator dispatch timeout to `swarm run` and uses the same value as the hard process cap.
- `--base-dir <path>` chooses where per-harness temp directories are created.
- `--cli-bin <path>` points at a specific built `dist/cli.mjs`.
- `--keep-artifacts` retains temp directories for post-mortem inspection.

### Output

A single JSON object on stdout:

```json
{
  "status": "ok" | "failed",
  "runs": [
    {
      "harness": "claude",
      "status": "ok",
      "exitCode": 0,
      "command": ["node", "/path/to/dist/cli.mjs", "run", "1", "...", "--preset", "product-decision", "--quiet"],
      "durationMs": 12345,
      "startedAt": "2026-04-28T00:00:00.000Z",
      "finishedAt": "2026-04-28T00:00:12.345Z",
      "artifactDir": "/tmp/swarm-real-smoke-claude-XYZ/.swarm/runs/...",
      "harnessVersion": "1.2.3 (anthropic-claude)",
      "failureReason": null,
      "stdoutTail": "...",
      "stderrTail": "...",
      "validatorResult": { "ok": true, "errors": [] }
    }
  ]
}
```

Aggregated `status` is `"ok"` only if every entry in `runs` is `"ok"`. Exit codes:

- `0` when `status === "ok"`.
- `1` when any pass failed.
- `2` on argument-parse errors.

Per-pass `failureReason` is one of `harness-binary-missing | swarm-run-nonzero | swarm-run-timeout | artifact-dir-not-found | artifact-validation-failed`. `validatorResult` carries offline artifact validation results when the swarm command exits successfully and an artifact directory is found; otherwise it is `null`. Validation errors are `{ "path": string, "message": string }` entries.

## Architecture

### Pipeline at a glance

`runSwarm` (in `src/lib/run-swarm.ts`) is the orchestrator. The lifecycle:

1. **Resolve config + agents.** `cli.ts` layers CLI flags > project config > preset defaults, then loads `AgentRegistry` and resolves each agent's runtime via `resolveAgentRuntimes`. When `resolveMode === "orchestrator"`, the bundled `orchestrator` agent is included in runtime resolution; without a run-level backend override, homogeneous selected-agent harnesses are inferred onto that orchestrator.
2. **Resolve harnesses per agent.** Each agent picks a harness via `agent.harness` → run-level `--backend`/`config.backend` → `agent.backend`. Harness ≠ backend: `BackendId` is `claude | codex` (the run-level dial), `HarnessId` is `claude | codex | opencode | rovo` (per-agent dispatch). `assertResolvedRuntimesAvailable` fails fast on unimplemented harnesses.
3. **Per-agent dispatch.** `createAgentAdapterResolver` returns a `BackendAdapter` per agent based on resolved harness; `round-runner.ts` calls that adapter, not the run-level backend. The run-level backend is still used for run metadata (`wrapperName`).
4. **Round execution.** `createRoundRunner` runs agents in parallel with `DEFAULT_CONCURRENCY = 3`, `config.timeoutMs` (default `DEFAULT_DISPATCH_TIMEOUT_MS = 120_000`), and one `MAX_FORMAT_REPAIR_ATTEMPTS` retry on JSON parse failure. Output is validated against `AgentOutputSchema`.
5. **Between rounds.** `betweenRounds` builds the next directive from the prior packet. In `orchestrator` mode, `orchestrator-dispatcher.ts` calls the bundled orchestrator agent for a structured `OrchestratorOutput`; otherwise the directive is templated. The directive is staged as a broadcast `MessageEnvelope` for the selected next-round recipients, `orchestratorPasses` and `pendingBetweenRounds` are persisted for resume, and failed orchestrator dispatch finalizes the run as failed.
6. **Persistence.** Three append-only writers fan out from `OutputRouter`: `ArtifactWriter` (round folders + manifest), `LedgerWriter` (`events.jsonl` + `messages.jsonl`), `CheckpointWriter` (`checkpoint.json`). Round writes happen on `round:done` and are awaited in `betweenRounds` so checkpoint ordering is deterministic.
7. **Synthesis.** `buildOrchestratorSynthesis` is fully deterministic — consensus, stance tally, top recommendation by confidence with alphabetical tie-break, shared risks (≥2 agents), deferred questions across all rounds, rounded average confidence.

`resumeSwarm` rehydrates from `checkpoint.json` + the message ledger, reloads optional carry-forward doc snapshots and prior orchestrator pass state, reuses the same `runDir`/`runId`, skips `ArtifactWriter.init()` (would clobber `manifest.json`/`seed-brief.md`), and restarts from `lastCompletedRound + 1`. Synthesis on resume concatenates `resumedRoundResults` with `result.rounds`.

### Source layout

```
src/
├── cli.ts                 # Commander entry point
├── backends/
│   ├── claude-cli.ts      # Claude CLI backend adapter
│   ├── codex-cli.ts       # Codex CLI backend adapter
│   ├── harness-adapter.ts # Runtime harness adapter bridge
│   ├── opencode-cli.ts    # OpenCode CLI harness adapter
│   ├── rovo-acli.ts       # Rovo Dev acli harness adapter
│   └── factory.ts         # Backend adapter selection
├── lib/
│   ├── artifact-validator.ts      # Offline run artifact validation
│   ├── backend-selection.ts       # Backend/config compatibility checks
│   ├── brief-generator.ts         # Seed + round brief generation
│   ├── doc-inputs.ts              # Carry-forward doc validation and snapshots
│   ├── harness-capability.ts      # Harness CLI capability probes
│   ├── harness-registry.ts        # Harness descriptors and availability
│   ├── harness-resolution.ts      # Per-agent harness/model resolution
│   ├── orchestrator-dispatcher.ts # LLM-driven between-round orchestrator dispatch
│   ├── orchestrator-output.ts     # Orchestrator output normalization and validation
│   ├── orchestrator-prompt.ts     # Orchestrator prompt construction
│   ├── real-harness-smoke.ts      # Real harness smoke gate runner
│   ├── round-runner.ts            # Concurrent agent dispatch with events
│   ├── synthesis.ts               # Deterministic synthesis engine
│   ├── artifact-writer.ts         # Incremental disk persistence
│   ├── checkpoint-writer.ts       # Atomic durable recovery checkpoints
│   ├── ledger-writer.ts           # Append-only message and event ledgers
│   ├── inbox-manager.ts           # Staged/committed message delivery
│   ├── scheduler.ts               # Per-round agent selection
│   ├── run-swarm.ts               # Pipeline orchestrator
│   ├── parse-command.ts           # CLI argument parsing/validation
│   └── config.ts                  # SwarmRunConfig types
├── scripts/
│   └── real-harness-smoke.ts      # CLI wrapper for pnpm smoke:real
├── schemas/                       # Zod schemas for all data contracts
│   ├── backend-id.ts              # Shared backend identifier schema
│   ├── harness-id.ts              # Shared harness identifier schema
│   ├── message.ts                 # Durable message envelope schema
│   ├── orchestrator-output.ts     # Structured LLM orchestrator pass schema
│   ├── resolved-agent-runtime.ts  # Per-agent runtime metadata schema
│   ├── run-checkpoint.ts          # Recovery checkpoint schema
│   └── run-event.ts               # Orchestration event schema
└── ui/                            # Terminal rendering (live + quiet)
```

### Schemas

All cross-boundary contracts are Zod schemas (no hand-rolled types). Important ones: `AgentOutputSchema`, `OrchestratorOutputSchema`, `RunManifest`, `RunCheckpoint`, `RunEvent`, `MessageEnvelope`, `RoundPacket`, `ResolvedAgentRuntime`. `BackendId` and `HarnessId` are deliberately separate schemas — don't conflate them when adding new dispatch paths.

### Validation constraints

`parse-command.ts` enforces: rounds 1–3, agents 2–5, lowercase agent name with `-`/`_` only, resolve mode `off | orchestrator | agents` (with synonyms). Errors throw `SwarmCommandError` and surface to the user with exit code `2`.
