# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

`swarm` is a TypeScript CLI that fans out 2–5 agents in parallel rounds (1–3 rounds), collects structured JSON output, and produces a deterministic synthesis. Built as ESM, distributed as a single `dist/cli.mjs` bin via `tsdown`. Node ≥ 20 (24 LTS pinned in `.nvmrc`), pnpm 10.

The README is the authoritative user-facing spec — when alpha behavior is ambiguous, README contracts win.

## Commands

```bash
pnpm build           # tsdown bundle + copies bundled agents/presets into dist/
pnpm dev             # tsdown --watch
pnpm test            # vitest unit tests (test/unit/**)
pnpm test:e2e        # builds, then vitest with vitest.e2e.config.ts (test/e2e/**)
pnpm smoke           # builds, runs only test/e2e/smoke.test.ts (golden-path verification)
pnpm typecheck       # tsc -p tsconfig.typecheck.json --noEmit
pnpm lint            # eslint src
pnpm format          # prettier --write src test
pnpm format:check    # prettier --check src test
```

Run a single test file: `vitest run test/unit/path/to/file.test.ts` (or `--config vitest.e2e.config.ts` for e2e). Filter by name: `vitest run -t "pattern"`.

The `.no-mistakes.yaml` workflow runs `pnpm test` for tests and `pnpm lint && pnpm typecheck && pnpm format:check` for lint — keep all three green together when changing src.

After build, `pnpm link --global` exposes the `swarm` bin. The bin is `dist/cli.mjs`; bundled agent/preset YAML files must be copied into `dist/agents/bundled/` and `dist/presets/bundled/` (the `build` script does this — don't edit `dist/` by hand).

## Architecture

### Pipeline (src/lib/run-swarm.ts)

`runSwarm` is the orchestrator. Lifecycle per run:

1. **Resolve config + agents.** `cli.ts` layers CLI flags > project config (`.swarm/config.yml`) > preset defaults, then loads `AgentRegistry` and resolves each agent's runtime (`resolveAgentRuntimes`).
2. **Resolve harnesses per agent.** Each agent picks a harness in this order: `agent.harness` → run-level `--backend`/`config.backend` → `agent.backend`. Harness ≠ backend: `BackendId` is `claude | codex` (the run-level dial), `HarnessId` is `claude | codex | opencode | rovo` (per-agent dispatch). `assertResolvedRuntimesAvailable` fails fast on unimplemented harnesses.
3. **Per-agent dispatch.** `createAgentAdapterResolver` returns a `BackendAdapter` per agent based on its resolved harness; `round-runner.ts` calls that adapter (not the run-level `backend`) for the actual CLI shell-out. The run-level `backend` is still used for run metadata (`wrapperName`).
4. **Round execution.** `createRoundRunner` runs agents in parallel with `DEFAULT_CONCURRENCY = 3`, `DEFAULT_TIMEOUT_MS = 120_000`, and one `MAX_FORMAT_REPAIR_ATTEMPTS` retry when JSON parse fails. Output is validated against `AgentOutputSchema` (Zod).
5. **Between rounds.** `betweenRounds` builds an orchestrator pass directive from the prior packet, stages it as a broadcast `MessageEnvelope` for the selected next-round recipients (via `selectAgentsForRound`), and writes a checkpoint.
6. **Persistence.** Three append-only writers fan out from `OutputRouter`: `ArtifactWriter` (round folders + manifest), `LedgerWriter` (`events.jsonl` + `messages.jsonl`), `CheckpointWriter` (`checkpoint.json`). Round writes happen on `round:done` and are awaited in `betweenRounds` so checkpoint ordering is deterministic.
7. **Synthesis.** `buildOrchestratorSynthesis` is fully deterministic (no LLM call) — consensus, stance tally, top recommendation by confidence with alphabetical tie-break, shared risks (≥2 agents), rounded average confidence.

`resumeSwarm` rehydrates from `checkpoint.json` + the message ledger, reuses the same `runDir`/`runId`, skips `ArtifactWriter.init()` (would clobber `manifest.json`/`seed-brief.md`), and restarts from `lastCompletedRound + 1`. Synthesis on resume concatenates `resumedRoundResults` with `result.rounds`.

### Backend & harness layering (src/backends/)

- `factory.ts` → `createBackendAdapter(BackendId)` for the run-level adapter (claude or codex only).
- `harness-adapter.ts` → `createHarnessAdapter(HarnessId)` and `HarnessAdapterRegistry` (cached per harness). `buildHarnessAdapterRegistry` pre-warms one adapter per resolved harness; `createAgentAdapterResolver` returns a function `(AgentDefinition) => BackendAdapter` so each agent's dispatch is decoupled from the run-level backend.
- Each adapter (`claude-cli.ts`, `codex-cli.ts`, `opencode-cli.ts`, `rovo-acli.ts`) shells out to the matching CLI via `execa`. Model selection is harness-specific: `claude --model`, `codex -m`, `opencode --model`, `acli rovodev run --model`.
- `harness-capability.ts` runs the auth/version probes consumed by `swarm doctor`.

### Registries (project > user > bundled)

`AgentRegistry` (`src/lib/agent-registry.ts`) and `PresetRegistry` (`src/lib/preset-registry.ts`) load from three roots, first match wins:

| Scope         | Agents                                           | Presets                |
| ------------- | ------------------------------------------------ | ---------------------- |
| Project       | `.swarm/agents/*.yml` / `.md`                    | `.swarm/presets/*.yml` |
| User          | `~/.swarm/agents/*.yml` / `.md`                  | `~/.swarm/presets/*.yml` |
| Bundled       | `src/agents/bundled/` (copied to `dist/`)        | `src/presets/bundled/` |

Same-name override across scopes is allowed; duplicates inside one scope are an error. Markdown agents use YAML frontmatter validated against the same Zod schema as `.yml` agents.

### Schemas (src/schemas/)

All cross-boundary contracts are Zod schemas (no hand-rolled types). Important ones: `AgentOutputSchema` (the JSON each agent must return), `RunManifest`, `RunCheckpoint`, `RunEvent`, `MessageEnvelope`, `RoundPacket`, `ResolvedAgentRuntime`. `BackendId` and `HarnessId` are deliberately separate schemas — don't conflate them when adding new dispatch paths.

### Constraints baked into validation

`parse-command.ts` enforces: rounds 1–3, agents 2–5, lowercase agent name with `-`/`_` only, resolve mode `off | orchestrator | agents` (with synonyms). Errors are thrown as `SwarmCommandError` and surface to the user with exit code `2`.

### Run artifacts (`.swarm/runs/<ts>-<slug>/`)

`manifest.json`, `checkpoint.json`, `events.jsonl`, `messages.jsonl`, `seed-brief.md`, `round-NN/{brief.md,agents/<name>.md}`, `synthesis.json`, `synthesis.md`. Per-agent markdown headers include `Harness:` / `Model:` when `agentRuntimes` is present in the manifest.

### Terminal UI (src/ui/)

`live-renderer.ts` is the default for TTY (cell-based diff render to avoid flicker); `quiet-logger.ts` is one-line-per-event for CI/non-TTY. Mode is auto-selected from `process.stderr.isTTY` unless `--quiet` (or `ui: "silent"` in tests) is set.

## Conventions

- **ESM only.** Imports use `.js` extensions even for `.ts` source (TS `moduleResolution: "bundler"`). Don't drop the extension.
- **Strict TS.** `tsconfig.json` is strict. Prefer Zod-inferred types (`z.infer<typeof Schema>`) over hand-rolled interfaces for any data that crosses the disk/wire boundary.
- **No new error-handling for impossible states.** Validation lives at boundaries (CLI parsing, schema decode, harness probe) — internal callers can trust resolved values.
- **Don't edit `dist/`.** Always rebuild via `pnpm build`. The build step also copies `src/agents/bundled/*` and `src/presets/bundled/*` — adding a new bundled agent/preset means adding the YAML, no code wiring needed.
- **Tests are split.** Unit tests under `test/unit/` mirror `src/` layout and run via `pnpm test`. End-to-end tests under `test/e2e/` build the CLI and shell out to it; they require `pnpm test:e2e` (which builds first). `pnpm smoke` is the minimal e2e subset to run before cutting an alpha release.
- **`swarm doctor` before claiming a run works.** It validates project config, agent/preset registries, backend compatibility, and probes harness CLIs for auth. Exit codes: `0` ok, `1` checks failed, `2` internal error — match this convention if adding new diagnostics.
