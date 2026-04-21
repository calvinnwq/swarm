# swarm

Standalone TypeScript CLI for running agent swarms — parse a topic, fan out agents in parallel rounds, collect structured output, synthesize.

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

## Usage

```
Usage: swarm [options] [command]

Fan out agents in parallel rounds, collect structured output, synthesize.

Options:
  -V, --version                      output the version number
  -h, --help                         display help for command

Commands:
  run [options] <rounds> <topic...>  Run a swarm
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
  --resolve <mode>   record resolution mode in manifest: off | orchestrator | agents
                     (between-round sub-pass not yet implemented)
  --goal <text>      primary goal for the swarm
  --decision <text>  decision target for the swarm
  --doc <path>       carry-forward document (repeatable)
  --preset <name>    named preset (resolves to agents when --agents not provided)
  --quiet            force quiet (one-line-per-event) output; default auto by TTY
  -h, --help         display help for command
```

**Example:**

```bash
swarm run 2 "Should we adopt server components?" \
  --agents product-manager,principal-engineer \
  --goal "Decide on migration strategy" \
  --decision "Adopt / Defer / Reject"
```

> **Heads up — `--resolve` is a stub for alpha.** The value is accepted, persisted in the run manifest, and carried through synthesis, but no between-round question-resolution sub-pass runs yet. Pass it for forward-compatibility; expect no functional change between modes today.

### Bundled presets

Swarm ships with one opinionated built-in preset:

| Preset             | Agents                                  | Resolve        | Best for                                                                             |
| ------------------ | --------------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `product-decision` | `product-manager`, `principal-engineer` | `orchestrator` | Framing a product decision with paired user-value and engineering-feasibility lenses |

Invoke it by name — no `--agents` required:

```bash
swarm run 2 "Should we adopt server components?" --preset product-decision
```

CLI flags still win over preset defaults, so you can override `--resolve`, `--goal`, or `--decision` per run. Drop a YAML file into `.swarm/presets/<name>.yml` (project) or `~/.swarm/presets/<name>.yml` (global) to define your own; project entries take precedence over global, and global over bundled.

### `swarm doctor`

Run `swarm doctor` to validate your setup before a run. It checks that `.swarm/config.yml` parses cleanly, that the agent and preset registries load, and that any agents or preset referenced in the project config actually resolve. The command exits `0` when everything is ready, `1` when any check fails (with actionable per-check messages), and `2` on an internal command error.

```bash
swarm doctor
```

## Agent configuration

Agent definitions are YAML or Markdown files loaded from two locations:

| Path                                             | Scope              |
| ------------------------------------------------ | ------------------ |
| `.swarm/agents/*.yml` / `.swarm/agents/*.md`     | Project-local      |
| `~/.swarm/agents/*.yml` / `~/.swarm/agents/*.md` | Global (user-wide) |

Project-local agents take precedence over global agents with the same name.

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
backend: claude # default; only supported backend currently
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
backend: claude
---

Evaluate the topic from a technical architecture lens. Consider
system complexity, operational burden, and migration risk.
```

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
├── manifest.json          # Run metadata (topic, rounds, agents, timestamps)
├── seed-brief.md          # Initial brief sent to all agents in round 1
├── round-01/
│   ├── brief.md           # Round brief (same as seed-brief for round 1)
│   └── agents/
│       ├── product-manager.md
│       └── principal-engineer.md
├── round-02/
│   ├── brief.md           # Includes prior-round packet for context
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
pnpm typecheck       # type checking
pnpm lint            # eslint
pnpm format:check    # prettier check
```

### Architecture

```
src/
├── cli.ts                 # Commander entry point
├── backends/
│   └── claude-cli.ts      # Claude CLI backend adapter
├── lib/
│   ├── brief-generator.ts # Seed + round brief generation
│   ├── round-runner.ts    # Concurrent agent dispatch with events
│   ├── synthesis.ts       # Deterministic synthesis engine
│   ├── artifact-writer.ts # Incremental disk persistence
│   ├── run-swarm.ts       # Pipeline orchestrator
│   ├── parse-command.ts   # CLI argument parsing/validation
│   └── config.ts          # SwarmRunConfig types
├── schemas/               # Zod schemas for all data contracts
└── ui/                    # Terminal rendering (live + quiet)
```

## Migration note

This TypeScript CLI is contract-compatible with the Python swarm prototype. Agent definitions, output schemas, and artifact layout follow the same contracts — existing `.swarm/agents/` directories and automation that consumes `.swarm/runs/` artifacts will work without changes.
