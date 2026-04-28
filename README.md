# swarm

Standalone TypeScript CLI for running agent swarms — parse a topic, fan out agents in parallel rounds, collect structured output, synthesize.

> **Alpha status.** This README documents the one supported golden path. Features not listed here (and especially modes flagged _not yet implemented_) are not part of the alpha contract and may not behave as advertised.

## Install

Requires Node ≥ 20 (Node 24 LTS recommended — `.nvmrc` pins it; run `nvm use`) and pnpm 10.

```bash
pnpm install
pnpm build
pnpm link --global
```

> **First time using `pnpm link --global` on this machine?** You'll need pnpm's
> global bin directory configured once. Run `pnpm setup`, then open a new
> shell (or `source ~/.zshrc` / `source ~/.bashrc`) before re-running
> `pnpm link --global`. This is a one-time pnpm setup, not a swarm-specific
> step — see the [pnpm docs](https://pnpm.io/cli/setup).
>
> Prefer not to configure pnpm globally? Substitute `npm link` for
> `pnpm link --global` — it uses npm's prefix (typically already on PATH via
> nvm/Homebrew) and works fine against a pnpm-installed dep tree because
> `bin` entries are standard.

## Releases

GitHub releases are managed by Release Please. After release-driving
Conventional Commits such as `feat:`, `fix:`, or `deps:` land on `main`, the
release workflow opens or updates a Release Please PR with the next version and
`CHANGELOG.md` entry. Merging that PR creates the git tag and GitHub Release.

npm publishing is not automated yet.

## Quickstart (golden path)

The supported alpha flow uses the bundled `product-decision` preset, which pairs the bundled `product-manager` and `principal-engineer` agents — no config or custom agent definitions required.

```bash
# 1. Verify your setup
swarm doctor

# 2. Run a 2-round swarm on a framed product decision
swarm run 2 "Should we adopt server components?" \
  --preset product-decision \
  --goal "Decide on migration strategy" \
  --decision "Adopt / Defer / Reject"
```

Artifacts land under `.swarm/runs/<timestamp>-<slug>/` (see [Artifact layout](#artifact-layout)), with a deterministic `synthesis.md` at the end. Use `--quiet` for CI-style one-line-per-event output.

## Usage

```
Usage: swarm [options] [command]

Fan out agents in parallel rounds, collect structured output, synthesize.

Options:
  -V, --version                      output the version number
  -h, --help                         display help for command

Commands:
  run [options] <rounds> <topic...>  Run a swarm
  doctor                             Diagnose swarm setup: config, agents, presets, backend selection, and harness capability
  help [command]                     display help for command
```

### `swarm run`

```
Usage: swarm run [options] <rounds> <topic...>

Run a swarm

Arguments:
  rounds             number of rounds (1–3)
  topic              topic for the swarm

Options:
  --agents <list>    comma-separated agent names
  --backend <name>   runtime backend adapter (currently: claude, codex)
  --resolve <mode>   between-round resolution mode: off | orchestrator | agents.
                     orchestrator runs an LLM-driven pass that updates question
                     resolutions and the next-round directive; off uses the
                     deterministic directive only; agents is reserved.
  --goal <text>      primary goal for the swarm
  --decision <text>  decision target for the swarm
  --doc <path>       carry-forward document (repeatable)
  --preset <name>    named preset (resolves to agents when --agents not provided)
  --quiet            force quiet (one-line-per-event) output; default auto by TTY
  -h, --help         display help for command
```

#### Resolution modes

`--resolve` controls what happens **between rounds** while the run is in flight, in addition to being recorded in the manifest:

| Mode           | Between-round behavior                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `off`          | Deterministic only — the next-round brief gets a templated `Orchestrator Pass` summary built from the prior packet. No extra LLM call. Question resolutions stay empty.                                                                                                                                                                                          |
| `orchestrator` | Real LLM pass — the bundled `orchestrator` agent receives the prior packet and returns a structured `OrchestratorOutput` (directive, `questionResolutions`, `questionResolutionLimit`, `deferredQuestions`, `confidence`). The directive feeds round N+1's brief, the round-N packet is updated with the returned resolution fields, and each pass is captured in `checkpoint.json`. |
| `agents`       | Reserved — accepted and persisted in `manifest.json`/`synthesis.json` but currently behaves like `off` between rounds. Kept on the CLI surface so future agent-driven resolution can be wired in without a flag rename.                                                                                                                                          |

In `orchestrator` mode the run produces three additional audit signals:

- `events.jsonl` gets an `orchestrator:pass` event per between-round pass, with metadata for `agentName`, `directive`, `confidence`, `questionResolutionsCount`, `questionResolutionLimit`, and `deferredQuestionsCount`.
- `checkpoint.json` gains an `orchestratorPasses` array, one entry per pass with the full `OrchestratorOutput` snapshot for resume/rehydration.
- The next round's `brief.md` embeds the LLM-derived directive instead of the deterministic templated summary.

If the orchestrator dispatch fails (timeout, malformed JSON after the single repair attempt, non-zero exit), the run finalizes with status `failed`, emits a `run:failed` event, and exits `1`. Earlier successful passes remain captured in `checkpoint.json` so a resume can pick up cleanly.

```bash
# Run with orchestrator-driven resolution (default for the bundled preset)
swarm run 2 "Should we adopt server components?" \
  --preset product-decision \
  --resolve orchestrator
```

Carry-forward docs from `--doc` are resolved before the run, deduplicated by path, and must be readable files. Their first 4,000 characters are packed into the seed brief with provenance, so agents receive bounded source context rather than path-only metadata.

### Bundled presets

Swarm ships with four opinionated built-in presets:

| Preset                      | Agents                                                      | Resolve        | Best for                                                                             |
| --------------------------- | ----------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `product-decision`          | `product-manager`, `principal-engineer`                     | `orchestrator` | Framing a product decision with paired user-value and engineering-feasibility lenses |
| `product-decision-codex`    | `product-manager-codex`, `principal-engineer-codex`         | `orchestrator` | Running the same product-decision flow through Codex out of the box                  |
| `product-decision-opencode` | `product-manager-opencode`, `principal-engineer-opencode`   | `orchestrator` | Running the same product-decision flow through OpenCode out of the box               |
| `triad`                     | `product-manager`, `principal-engineer`, `product-designer` | `orchestrator` | Full product triad: value, feasibility, and UX perspective together                  |

Invoke it by name — no `--agents` required:

```bash
swarm run 2 "Should we adopt server components?" --preset product-decision
```

CLI flags still win over preset defaults, so you can override `--resolve`, `--goal`, or `--decision` per run.

### Preset loading and override rules

Presets are resolved from three roots in priority order — the first match wins:

| Source        | Path                     | Scope          |
| ------------- | ------------------------ | -------------- |
| Project-local | `.swarm/presets/*.yml`   | This repo      |
| User-global   | `~/.swarm/presets/*.yml` | Your machine   |
| Bundled       | _(ships with swarm)_     | Always present |

A project-local preset with the same `name` as a bundled preset fully replaces it for that project. A user-global preset with the same name overrides the bundled version machine-wide but yields to any project-local definition. Duplicate `name` values within the same root (two files in `.swarm/presets/` declaring the same name) are an error. Drop a YAML file into `.swarm/presets/<name>.yml` (project) or `~/.swarm/presets/<name>.yml` (global) to define your own.

For Codex-backed runs, use the dedicated preset:

```bash
swarm run 2 "Should we adopt server components?" \
  --preset product-decision-codex
```

The bundled Codex preset pins Codex-backed agents, and `--resolve orchestrator` dispatches the orchestrator through Codex when every selected agent resolves to Codex. Use `--backend codex` only when you want to override unpinned agents at the run level. This requires the `codex` CLI to be installed, available on `PATH`, already authenticated with `codex login`, and new enough to support `codex exec` because the Codex backend shells out to `codex exec` at runtime. The Claude backend likewise requires the `claude` CLI on `PATH` and an existing `claude auth login` session.

For OpenCode-backed runs, use the dedicated preset:

```bash
swarm run 2 "Should we adopt server components?" \
  --preset product-decision-opencode
```

The bundled OpenCode preset pins OpenCode-backed agents. This requires the `opencode` CLI to be installed, available on `PATH`, and already authenticated with `opencode auth login`.

Custom preset files are strict YAML objects with required `name` and `agents` fields plus optional `description`, `resolve`, `goal`, and `decision` fields:

```yaml
name: product-decision
description: Product and engineering framing for major product bets
agents:
  - product-manager
  - principal-engineer
resolve: orchestrator
goal: Decide on migration strategy
decision: Adopt / Defer / Reject
```

Preset names must use lowercase letters, numbers, `-`, or `_`, and `agents` must list 2-5 agent names.

### `swarm doctor`

Run `swarm doctor` to validate your setup before a run. It checks that `.swarm/config.yml` parses cleanly, that configured carry-forward `docs` paths are readable files and reports which docs will be truncated into bounded context packets, that the agent and preset registries load, that any agents or preset referenced in the project config actually resolve, that any configured backend is supported and matches config agents that do not pin `harness`, and, when a project config is loaded, that the configured agents' resolved harness CLIs are runnable. Claude, Codex, and OpenCode probes verify authentication; Codex also verifies `codex exec` support; Rovo verifies `acli rovodev` is installed and runnable. Without `.swarm/config.yml`, `swarm doctor` skips harness capability checks. The command exits `0` when everything is ready, `1` when any check fails (with actionable per-check messages), and `2` on an internal command error.

```bash
swarm doctor
```

### Real-harness smoke gate (`pnpm smoke:real`)

`pnpm smoke:real` is a **manual release gate** that runs the built `swarm` CLI against one or more real harness CLIs and prints a normalized JSON summary. It is intentionally **not** part of `pnpm test`, `pnpm test:e2e`, or CI — those suites use stubbed harnesses for speed and determinism. Reach for `smoke:real` when you want to verify a release candidate end-to-end against the actual harness binaries.

Prerequisites:

- The target harness CLIs are on `PATH` and authenticated (`claude auth login`, `codex login`, `opencode auth login`).
- The repo has been built (the script runs `pnpm build` for you).

Quickstart:

```bash
# Single harness — uses bundled product-decision (claude default)
pnpm smoke:real --harness claude --topic "release readiness check"

# Mixed harnesses, run sequentially with isolated working dirs
pnpm smoke:real --harness claude,codex --topic "release readiness check"

# OpenCode end-to-end — uses bundled product-decision-opencode preset
pnpm smoke:real --harness opencode --topic "release readiness check"
```

By default each harness uses its bundled preset (`product-decision` for claude, `product-decision-codex` for codex, `product-decision-opencode` for opencode). Pass `--preset <name>` to override every pass, `--rounds <1-3>` to bump rounds (default `1`), `--timeout-ms <n>` to cap each run, `--base-dir <path>` to choose where per-harness temp directories are created, `--cli-bin <path>` to point at a specific built `dist/cli.mjs`, and `--keep-artifacts` to retain temp directories for post-mortem inspection.

Output is a single JSON object on stdout:

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

Aggregated `status` is `"ok"` only if every entry in `runs` is `"ok"`. The script exits `0` when `status === "ok"`, exits `1` when any pass failed, and exits `2` on argument-parse errors. Per-pass `failureReason` is one of `harness-binary-missing | swarm-run-nonzero | swarm-run-timeout | artifact-dir-not-found | artifact-validation-failed`. `validatorResult` contains offline artifact validation results when the swarm command exits successfully and an artifact directory is found, including validation failures; otherwise it is `null`. Validation errors are `{ "path": string, "message": string }` entries.

## Project config (`.swarm/config.yml`)

Optional. Set project defaults so teammates don't have to remember the flags.

```yaml
preset: product-decision
# or instead of preset, pin an explicit agent list:
# agents: [product-manager, principal-engineer]
backend: claude
goal: Decide on migration strategy
decision: Adopt / Defer / Reject
resolve: off # off | orchestrator | agents — see "Resolution modes" above
docs:
  - docs/architecture.md
```

Precedence: **CLI flags > config values > preset defaults**. The file is optional — when missing, CLI flags alone fully describe the run. Validation errors (unknown keys, wrong types) are reported by `swarm doctor` and at run start.

Configured `docs` use the same carry-forward behavior as repeated `--doc` flags: paths are normalized, readable files are required, and each document contributes at most 4,000 characters to the run context.

Supported fields: `preset`, `agents` (2–5 names), `backend`, `resolve`, `goal`, `decision`, `docs`. The `rounds` key is reserved but not yet applied — pass `<rounds>` on the CLI.

## Agent configuration

Agent definitions are YAML or Markdown files resolved from three roots (first wins):

| Path                                             | Scope                             |
| ------------------------------------------------ | --------------------------------- |
| `.swarm/agents/*.yml` / `.swarm/agents/*.md`     | Project-local                     |
| `~/.swarm/agents/*.yml` / `~/.swarm/agents/*.md` | Global (user-wide)                |
| _(bundled)_                                      | Ships with swarm; see table below |

Swarm ships with eight bundled agents:

| Agent                         | Role                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| `product-manager`             | User value, scope, and decision framing                         |
| `principal-engineer`          | System design, feasibility, and operational risk                |
| `product-designer`            | UX, usability, and user-journey perspective                     |
| `product-manager-codex`       | Codex-backed product decision framing                           |
| `principal-engineer-codex`    | Codex-backed engineering feasibility                            |
| `product-manager-opencode`    | OpenCode-backed product decision framing                        |
| `principal-engineer-opencode` | OpenCode-backed engineering feasibility                         |
| `orchestrator`                | Coordinator persona for between-round context and resolve modes |

A project-local agent with the same `name` as a bundled agent fully replaces it for that project. A user-global agent overrides the bundled version machine-wide but yields to any project-local definition. Duplicate `name` values within the same root are an error.

### YAML format

```yaml
name: product-manager
description: Strategic product perspective
persona: >
  You are a senior product manager focused on user outcomes,
  market timing, and business viability.
prompt: >
  Evaluate the topic from a product strategy lens. Consider
  user impact, competitive landscape, and delivery risk.
backend: claude # or codex
```

### Markdown format

Markdown agents use YAML frontmatter (validated against the same schema) with the markdown body as the prompt:

```markdown
---
name: principal-engineer
description: Deep technical architecture perspective
persona: >
  You are a principal engineer focused on system design,
  scalability, and long-term maintainability.
backend: claude # or codex
---

Evaluate the topic from a technical architecture lens. Consider
system complexity, operational burden, and migration risk.
```

### Harness and model selection

Each agent can pin the runtime harness and model it dispatches through, independent of the run-level `--backend`. Two optional fields are recognized on every agent definition (YAML or Markdown frontmatter):

| Field     | Values                                | Default                                                         |
| --------- | ------------------------------------- | --------------------------------------------------------------- |
| `harness` | `claude`, `codex`, `opencode`, `rovo` | Falls back to the run-level backend, then the agent's `backend` |
| `model`   | Any non-empty string                  | Harness default (the harness chooses)                           |

Resolution order per agent (first wins): `agent.harness` → explicit run-level `--backend` or project `backend` → `agent.backend`. If no run-level backend is configured, the agent's `backend` field continues to select its harness. When `--resolve orchestrator` is active without a run-level backend override, the bundled orchestrator inherits the selected agents' harness if they all resolve to the same harness; mixed-harness swarms keep the orchestrator's default. The resolved (`harness`, `model`) pair is captured in `manifest.json` under `agentRuntimes` and rendered into each agent's per-round markdown header (`Harness:` / `Model:`).

This unlocks **mixed-harness swarms**: a single run can route one agent through Claude and another through Codex (or OpenCode / Rovo Dev), as long as each harness's CLI is installed and passes its capability probe. Claude, Codex, and OpenCode must be authenticated; Rovo requires `acli` with the `rovodev` plugin to be runnable. Example agent overrides for a mixed run:

```yaml
# .swarm/agents/pm-mixed.yml — claude harness with a pinned model
name: pm-mixed
description: Product manager dispatched via Claude
persona: You are a rigorous product manager.
prompt: Evaluate the topic and return the swarm JSON contract.
harness: claude
model: claude-sonnet-4-5
```

```yaml
# .swarm/agents/pe-mixed.yml — codex harness, harness-default model
name: pe-mixed
description: Principal engineer dispatched via Codex
persona: You are a principal engineer.
prompt: Evaluate the topic and return the swarm JSON contract.
harness: codex
```

```bash
swarm run 1 "Should we adopt mixed-harness swarms" \
  --agents pm-mixed,pe-mixed \
  --resolve off
```

`swarm doctor` probes the configured agents' resolved harnesses when it can load them, otherwise it probes the run-level backend's harness. At run start, the CLI additionally fails fast if any agent requests an unimplemented harness, listing the harnesses currently available. When `agent.model` is set, every harness adapter forwards it to its CLI: `claude --model <model>`, `codex -m <model>`, `opencode --model <model>`, and `acli rovodev run --model <model>`. Omitting `agent.model` lets the harness pick its own default.

### Agent output schema

Each agent returns structured JSON:

```json
{
  "agent": "product-manager",
  "round": 1,
  "stance": "Adopt with caveats",
  "recommendation": "Proceed with a phased migration...",
  "reasoning": ["..."],
  "objections": ["..."],
  "risks": ["..."],
  "changesFromPriorRound": [],
  "confidence": "high",
  "openQuestions": ["..."]
}
```

## Artifact layout

Each run produces a self-contained directory under `.swarm/runs/`:

```
.swarm/runs/20260419-121439-should-we-adopt-server-components/
├── manifest.json          # Run metadata (run ID, status, topic, goal, decision, rounds, backend, agents, agentRuntimes, timestamps)
├── checkpoint.json        # Durable recovery checkpoint after completed rounds
├── events.jsonl           # Append-only orchestration event ledger
├── messages.jsonl         # Append-only staged/committed message ledger
├── seed-brief.md          # Initial brief sent to all agents in round 1
├── carry-forward-docs/    # Optional doc excerpts with provenance snapshots
│   ├── manifest.json
│   └── doc-01.md
├── round-01/
│   ├── brief.md           # Round brief (same as seed-brief for round 1)
│   └── agents/
│       ├── product-manager.md
│       └── principal-engineer.md
├── round-02/
│   ├── brief.md           # Includes prior-round packet and orchestrator pass context
│   └── agents/
│       ├── product-manager.md
│       └── principal-engineer.md
├── synthesis.json         # Deterministic synthesis output
└── synthesis.md           # Human-readable synthesis report
```

When agent runtimes are resolved, `manifest.json` includes `agentRuntimes`, and per-agent markdown files include `Harness:` and `Model:` header fields.

### Synthesis

Synthesis is deterministic (no LLM call). It aggregates all agent outputs to produce:

- **Consensus detection** — unanimous stance across agents in the final round
- **Stance tally** — count of each unique stance
- **Top recommendation** — picked by highest confidence, alphabetical tie-break
- **Shared risks** — risks flagged by 2+ agents, deduplicated across rounds
- **Deferred questions** — deferred items from every round, deduplicated and rendered in `synthesis.md`
- **Overall confidence** — rounded average of all agent confidence levels

## Terminal UX

The CLI provides two rendering modes:

- **Live mode** (default, TTY) — phase banner, per-agent status rows with elapsed timers, flicker-free cell-based diff rendering
- **Quiet mode** (`--quiet` / non-TTY) — structured one-line-per-event log output for CI

## Development

```bash
pnpm test            # unit tests
pnpm test:e2e        # end-to-end tests (builds first)
pnpm smoke           # golden-path smoke check (builds, runs doctor + preset flow)
pnpm smoke:real      # manual real-harness smoke gate (builds first)
pnpm typecheck       # type checking
pnpm lint            # eslint
pnpm format:check    # prettier check
```

`pnpm smoke` is the repeatable alpha verification: it builds, runs `swarm doctor` against the built CLI, and exercises the `--preset product-decision` flow end to end with a mock backend. Use it before cutting a release or after touching bundled agents, presets, or CLI wiring. For Codex-specific coverage, run `pnpm build && vitest run --config vitest.e2e.config.ts test/e2e/codex-backend.test.ts` or the full `pnpm test:e2e`.

### Architecture

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
│   ├── artifact-validator.ts # Offline run artifact validation
│   ├── backend-selection.ts # Backend/config compatibility checks
│   ├── brief-generator.ts # Seed + round brief generation
│   ├── doc-inputs.ts      # Carry-forward doc validation and snapshots
│   ├── harness-capability.ts # Harness CLI capability probes
│   ├── harness-registry.ts # Harness descriptors and availability
│   ├── harness-resolution.ts # Per-agent harness/model resolution
│   ├── orchestrator-dispatcher.ts # LLM-driven between-round orchestrator dispatch
│   ├── orchestrator-output.ts # Orchestrator output normalization and validation
│   ├── orchestrator-prompt.ts # Orchestrator prompt construction
│   ├── real-harness-smoke.ts # Real harness smoke gate runner
│   ├── round-runner.ts    # Concurrent agent dispatch with events
│   ├── synthesis.ts       # Deterministic synthesis engine
│   ├── artifact-writer.ts # Incremental disk persistence
│   ├── checkpoint-writer.ts # Atomic durable recovery checkpoints
│   ├── ledger-writer.ts   # Append-only message and event ledgers
│   ├── inbox-manager.ts   # Staged/committed message delivery
│   ├── scheduler.ts       # Per-round agent selection
│   ├── run-swarm.ts       # Pipeline orchestrator
│   ├── parse-command.ts   # CLI argument parsing/validation
│   └── config.ts          # SwarmRunConfig types
├── scripts/
│   └── real-harness-smoke.ts # CLI wrapper for pnpm smoke:real
├── schemas/               # Zod schemas for all data contracts
│   ├── backend-id.ts      # Shared backend identifier schema
│   ├── harness-id.ts      # Shared harness identifier schema
│   ├── message.ts         # Durable message envelope schema
│   ├── orchestrator-output.ts # Structured LLM orchestrator pass schema
│   ├── resolved-agent-runtime.ts # Per-agent runtime metadata schema
│   ├── run-checkpoint.ts  # Recovery checkpoint schema
│   └── run-event.ts       # Orchestration event schema
└── ui/                    # Terminal rendering (live + quiet)
```

## Migration note

This TypeScript CLI is contract-compatible with the Python swarm prototype. Agent definitions, output schemas, and artifact layout follow the same contracts — existing `.swarm/agents/` directories and automation that consumes `.swarm/runs/` artifacts will work without changes.
