# swarm

Standalone TypeScript CLI for running agent swarms — parse a topic, fan out agents in parallel rounds, collect structured output, synthesize.

> **Alpha status.** This README documents the one supported golden path. Features not listed here (and especially modes flagged _stub_ or _not yet implemented_) are not part of the alpha contract and may not behave as advertised.

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
  --resolve <mode>   record resolution mode in manifest: off | orchestrator | agents
                     (mode-specific resolution is stubbed)
  --goal <text>      primary goal for the swarm
  --decision <text>  decision target for the swarm
  --doc <path>       carry-forward document (repeatable)
  --preset <name>    named preset (resolves to agents when --agents not provided)
  --quiet            force quiet (one-line-per-event) output; default auto by TTY
  -h, --help         display help for command
```

> **Heads up — `--resolve` behavior is limited for alpha.** The value is accepted, persisted in the run manifest, and carried through synthesis. A between-round orchestrator pass now feeds later round briefs, but resolve modes do not yet change question-resolution behavior.

### Bundled presets

Swarm ships with three opinionated built-in presets:

| Preset                    | Agents                                                          | Resolve        | Best for                                                                             |
| ------------------------- | --------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `product-decision`        | `product-manager`, `principal-engineer`                         | `orchestrator` | Framing a product decision with paired user-value and engineering-feasibility lenses |
| `product-decision-codex`  | `product-manager-codex`, `principal-engineer-codex`             | `orchestrator` | Running the same product-decision flow through Codex out of the box                  |
| `triad`                   | `product-manager`, `principal-engineer`, `product-designer`     | `orchestrator` | Full product triad: value, feasibility, and UX perspective together                  |

Invoke it by name — no `--agents` required:

```bash
swarm run 2 "Should we adopt server components?" --preset product-decision
```

CLI flags still win over preset defaults, so you can override `--resolve`, `--goal`, or `--decision` per run.

### Preset loading and override rules

Presets are resolved from three roots in priority order — the first match wins:

| Source                                | Path                         | Scope         |
| ------------------------------------- | ---------------------------- | ------------- |
| Project-local                         | `.swarm/presets/*.yml`       | This repo     |
| User-global                           | `~/.swarm/presets/*.yml`     | Your machine  |
| Bundled                               | _(ships with swarm)_         | Always present |

A project-local preset with the same `name` as a bundled preset fully replaces it for that project. A user-global preset with the same name overrides the bundled version machine-wide but yields to any project-local definition. Duplicate `name` values within the same root (two files in `.swarm/presets/` declaring the same name) are an error. Drop a YAML file into `.swarm/presets/<name>.yml` (project) or `~/.swarm/presets/<name>.yml` (global) to define your own.

For Codex-backed runs, use the dedicated preset and backend pair:

```bash
swarm run 2 "Should we adopt server components?" \
  --preset product-decision-codex \
  --backend codex
```

This requires the `codex` CLI to be installed, available on `PATH`, already authenticated with `codex login`, and new enough to support `codex exec` because the Codex backend shells out to `codex exec` at runtime. The Claude backend likewise requires the `claude` CLI on `PATH` and an existing `claude auth login` session.

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

Run `swarm doctor` to validate your setup before a run. It checks that `.swarm/config.yml` parses cleanly, that the agent and preset registries load, that any agents or preset referenced in the project config actually resolve, that any configured backend is supported and matches the resolved config agents or preset agents, and, when a project config resolves an effective backend, that the underlying harness CLI is installed and authenticated. For Codex projects, that probe also verifies the installed CLI supports `codex exec`. Without `.swarm/config.yml`, `swarm doctor` skips harness capability checks. The command exits `0` when everything is ready, `1` when any check fails (with actionable per-check messages), and `2` on an internal command error.

```bash
swarm doctor
```

## Project config (`.swarm/config.yml`)

Optional. Set project defaults so teammates don't have to remember the flags.

```yaml
preset: product-decision
# or instead of preset, pin an explicit agent list:
# agents: [product-manager, principal-engineer]
backend: claude
goal: Decide on migration strategy
decision: Adopt / Defer / Reject
resolve: off # off | orchestrator | agents (limited; see note above)
docs:
  - docs/architecture.md
```

Precedence: **CLI flags > config values > preset defaults**. The file is optional — when missing, CLI flags alone fully describe the run. Validation errors (unknown keys, wrong types) are reported by `swarm doctor` and at run start.

Supported fields: `preset`, `agents` (2–5 names), `backend`, `resolve`, `goal`, `decision`, `docs`. The `rounds` key is reserved but not yet applied — pass `<rounds>` on the CLI.

## Agent configuration

Agent definitions are YAML or Markdown files resolved from three roots (first wins):

| Path                                             | Scope                             |
| ------------------------------------------------ | --------------------------------- |
| `.swarm/agents/*.yml` / `.swarm/agents/*.md`     | Project-local                     |
| `~/.swarm/agents/*.yml` / `~/.swarm/agents/*.md` | Global (user-wide)                |
| _(bundled)_                                      | Ships with swarm; see table below |

Swarm ships with six bundled agents:

| Agent                      | Role                                                            |
| -------------------------- | --------------------------------------------------------------- |
| `product-manager`          | User value, scope, and decision framing                         |
| `principal-engineer`       | System design, feasibility, and operational risk                |
| `product-designer`         | UX, usability, and user-journey perspective                     |
| `product-manager-codex`    | Codex-backed product decision framing                           |
| `principal-engineer-codex` | Codex-backed engineering feasibility                            |
| `orchestrator`             | Coordinator persona for between-round context and resolve modes  |

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

| Field      | Values                                 | Default                                    |
| ---------- | -------------------------------------- | ------------------------------------------ |
| `harness`  | `claude`, `codex`, `opencode`, `rovo`  | Falls back to the run-level backend, then the agent's `backend` |
| `model`    | Any non-empty string                   | Harness default (the harness chooses)      |

Resolution order per agent (first wins): `agent.harness` → explicit run-level `--backend` or project `backend` → `agent.backend`. If no run-level backend is configured, the agent's `backend` field continues to select its harness. The resolved (`harness`, `model`) pair is captured in `manifest.json` under `agentRuntimes` and rendered into each agent's per-round markdown header (`Harness:` / `Model:`).

This unlocks **mixed-harness swarms**: a single run can route one agent through Claude and another through Codex (or OpenCode / Rovo Dev), as long as each harness's CLI is installed and authenticated. Example agent overrides for a mixed run:

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
├── manifest.json          # Run metadata (run ID, status, topic, goal, decision, rounds, backend, agents, timestamps)
├── checkpoint.json        # Durable recovery checkpoint after completed rounds
├── events.jsonl           # Append-only orchestration event ledger
├── messages.jsonl         # Append-only staged/committed message ledger
├── seed-brief.md          # Initial brief sent to all agents in round 1
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

### Synthesis

Synthesis is deterministic (no LLM call). It aggregates all agent outputs to produce:

- **Consensus detection** — unanimous stance across agents in the final round
- **Stance tally** — count of each unique stance
- **Top recommendation** — picked by highest confidence, alphabetical tie-break
- **Shared risks** — risks flagged by 2+ agents, deduplicated across rounds
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
│   └── factory.ts         # Backend adapter selection
├── lib/
│   ├── backend-selection.ts # Backend/config compatibility checks
│   ├── brief-generator.ts # Seed + round brief generation
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
├── schemas/               # Zod schemas for all data contracts
│   ├── backend-id.ts      # Shared backend identifier schema
│   ├── message.ts         # Durable message envelope schema
│   ├── run-checkpoint.ts  # Recovery checkpoint schema
│   └── run-event.ts       # Orchestration event schema
└── ui/                    # Terminal rendering (live + quiet)
```

## Migration note

This TypeScript CLI is contract-compatible with the Python swarm prototype. Agent definitions, output schemas, and artifact layout follow the same contracts — existing `.swarm/agents/` directories and automation that consumes `.swarm/runs/` artifacts will work without changes.
