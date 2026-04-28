# Swarm CLI — Release Readiness Report

**Version:** 0.1.0  
**Date:** 2026-04-28  
**Decision:** ❌ NOT RELEASE READY — real-harness gates are unresolved (see below)

---

## Go / No-Go Table

| # | Gate | Status | Evidence / Blocker |
|---|------|--------|-------------------|
| M9-01 | Codex JSON schema strict validation | ✅ PASS | [see below](#m9-01-codex-json-schema) |
| M9-02 | Manual real-harness smoke runner | ✅ PASS | [see below](#m9-02-real-harness-smoke-runner) |
| M9-03 | Real Codex run end-to-end | ❌ BLOCKED | [NGX-144](https://linear.app/ngxcalvin/issue/NGX-144) — no Codex credentials in environment |
| M9-04 | Real Claude run (or documented timeout limitation) | ❌ BLOCKED | [NGX-145](https://linear.app/ngxcalvin/issue/NGX-145) — no Claude credentials in environment |
| M9-05 | Real OpenCode run end-to-end | ❌ BLOCKED | [NGX-146](https://linear.app/ngxcalvin/issue/NGX-146) — OpenCode not installed |
| M9-06 | Mixed Claude + Codex real harness run | ❌ BLOCKED | [NGX-147](https://linear.app/ngxcalvin/issue/NGX-147) — blocked on M9-03 and M9-04 |
| M9-07 | Offline artifact integrity validator | ✅ PASS | [see below](#m9-07-artifact-integrity-validator) |
| M9-08 | Resume durability (no re-dispatch) | ✅ PASS | [see below](#m9-08-resume-durability) |
| M9-09 | Doctor hardening (actionable messages) | ✅ PASS | [see below](#m9-09-doctor-hardening) |
| M9-10 | Clean clone quickstart matches README | ❌ BLOCKED | [NGX-151](https://linear.app/ngxcalvin/issue/NGX-151) — blocked on real harness credentials |
| M9-11 | Packaged CLI install (pnpm pack) | ✅ PASS | [see below](#m9-11-packaged-cli-install) |
| M9-12 | Release-readiness report (this doc) | ✅ PASS | — |
| M10-01 | Orchestrator resolution output schema | ✅ PASS | [see below](#m10-orchestrator-resolution-runtime) |
| M10-02 | Orchestrator resolution prompt | ✅ PASS | [see below](#m10-orchestrator-resolution-runtime) |
| M10-03 | Dispatch orchestrator between rounds | ✅ PASS | [see below](#m10-orchestrator-resolution-runtime) |
| M10-04 | Populate round packet question resolutions | ✅ PASS | [see below](#m10-orchestrator-resolution-runtime) |
| M10-05 | Persist orchestrator passes (ledger/checkpoint/resume) | ✅ PASS | [see below](#m10-orchestrator-resolution-runtime) |
| M10-06 | Docs, help text, e2e coverage for real orchestrator mode | ✅ PASS | [see below](#m10-orchestrator-resolution-runtime) |

---

## Passed Gates — Evidence

### M9-01 Codex JSON schema

**Issue:** [NGX-142](https://linear.app/ngxcalvin/issue/NGX-142)

`AGENT_OUTPUT_JSON_SCHEMA` in `src/backends/codex-cli.ts` sets `additionalProperties: false` at the root so the Codex CLI strict-schema validator accepts it.

```
Command: pnpm test -- test/unit/backends/codex-cli.test.ts
Result:  1 test file | 14 tests passed
Key assertion: schema.additionalProperties === false
```

### M9-02 Real-harness smoke runner

**Issue:** [NGX-143](https://linear.app/ngxcalvin/issue/NGX-143)

Added `src/scripts/real-harness-smoke.ts` (built to `dist/scripts/real-harness-smoke.mjs`) and a `pnpm smoke:real` convenience script. Supports `--harness`, `--topic`, `--preset`, `--rounds`, `--keep-artifacts`, `--base-dir`, `--cli-bin`, `--timeout-ms`, and emits a machine-readable JSON summary on stdout.

```
Command: pnpm build && node dist/scripts/real-harness-smoke.mjs --help
Entry:   src/scripts/real-harness-smoke.ts
Tests:   test/unit/lib/real-harness-smoke.test.ts — 15 tests passed (stub-backed)
Note:    Real harness invocation requires credentials; stub-backed unit tests prove
         runner logic (timeout, failure reasons, artifact discovery, JSON summary).
```

### M9-07 Artifact integrity validator

**Issue:** [NGX-148](https://linear.app/ngxcalvin/issue/NGX-148)

Added `src/lib/artifact-validator.ts` that validates `manifest.json`, `checkpoint.json`, `events.jsonl`, `messages.jsonl`, `seed-brief.md`, per-round `brief.md`, and optional `synthesis.json` against their Zod schemas. Cross-checks `runId` consistency between manifest and checkpoint. Integrated into `runRealHarnessSmoke` so real-harness smoke runs automatically validate artifacts.

```
Command: pnpm test -- test/unit/lib/artifact-validator.test.ts
Result:  21 tests passed
Command: pnpm test -- test/unit/lib/real-harness-smoke.test.ts
Result:  15 tests passed (includes 4 validator-integration tests)
```

### M9-08 Resume durability

**Issue:** [NGX-149](https://linear.app/ngxcalvin/issue/NGX-149)

E2E tests prove: completed rounds are not re-dispatched on resume, `events.jsonl` contains only resumed-run activity (no stale pre-crash events), and a 3-round run interrupted after round 2 resumes correctly dispatching only round 3.

```
Command: pnpm test:e2e -- test/e2e/durable-orchestration.test.ts
Result:  3 resume-specific tests passed (plus full durable-orchestration suite)
Tests:
  - resumed run dispatches only remaining rounds
  - resumed run events.jsonl reflects only the resumed run's agent activity
  - 3-round run interrupted after round 2 resumes with only round 3 dispatches
```

### M9-09 Doctor hardening

**Issue:** [NGX-150](https://linear.app/ngxcalvin/issue/NGX-150)

`swarm doctor` failing harness checks now append `required by: <agentName>, ...` to the failure detail, naming the exact agent(s) that require the harness. Missing-binary checks surface actionable install messages.

```
Command: pnpm test -- test/unit/lib/doctor-backend.test.ts
Result:  5 new tests passed:
  - missing claude binary → actionable install message
  - missing codex binary → actionable install message
  - missing opencode binary → actionable install message
  - harness fail detail names the config agent requiring the harness
  - harness fail detail names the preset agent requiring the harness
```

### M9-11 Packaged CLI install

**Issue:** [NGX-152](https://linear.app/ngxcalvin/issue/NGX-152)

`pnpm pack` produces a tarball containing `dist/cli.mjs`, 8 bundled agents, and 4 bundled presets. Installed outside the repo (via `npm install <tarball>`), `swarm --version` returns `0.1.0` and `swarm doctor` exits 0 discovering bundled assets from the installed path.

```
Command: pnpm build && pnpm pack
Tarball: swarm-0.1.0.tgz
Contents verified:
  dist/cli.mjs
  dist/agents/bundled/ (8 agents)
  dist/presets/bundled/ (4 presets)

Command (temp dir outside repo):
  npm install /path/to/swarm-0.1.0.tgz
  ./node_modules/.bin/swarm --version   → 0.1.0
  ./node_modules/.bin/swarm doctor       → exit 0
```

### M10 Orchestrator Resolution Runtime

**Issues:** [NGX-154](https://linear.app/ngxcalvin/issue/NGX-154) · [NGX-155](https://linear.app/ngxcalvin/issue/NGX-155) · [NGX-156](https://linear.app/ngxcalvin/issue/NGX-156) · [NGX-157](https://linear.app/ngxcalvin/issue/NGX-157) · [NGX-158](https://linear.app/ngxcalvin/issue/NGX-158) · [NGX-159](https://linear.app/ngxcalvin/issue/NGX-159)

All 6 M10 slices are implemented and tested:

- **Schema** (`OrchestratorOutputSchema`) with validation helpers and repair-prompt support
- **Prompt builder** (`buildOrchestratorResolutionPrompt`) feeding source-packet context + output contract
- **Dispatcher** (`dispatchOrchestratorPass`) wired into `runSwarm`/`resumeSwarm` behind `resolveMode === 'orchestrator'` gate
- **Packet mutation** — orchestrator output populates `questionResolutions`, `questionResolutionLimit`, `deferredQuestions` in the next round's packet; synthesis aggregates deferred questions across all rounds
- **Persistence** — `orchestratorPasses[]` field in `checkpoint.json`; structured `orchestrator:pass` event metadata in `events.jsonl`; rehydration on resume
- **Docs** — `--resolve` help text updated, README Resolution modes table added, e2e test proves `--resolve orchestrator` produces non-empty resolution artifacts

```
Command: pnpm test && pnpm test:e2e
Result:  1021 unit tests passed | e2e suite passed
Command: pnpm lint && pnpm typecheck && pnpm format:check
Result:  all clean
```

---

## Blocked Gates — Known Limitations

### M9-03 Real Codex run

**Issue:** [NGX-144](https://linear.app/ngxcalvin/issue/NGX-144)  
**Blocker:** No Codex API credentials available in this environment. The schema fix (M9-01) and smoke runner (M9-02) are complete; a real Codex proof requires `CODEX_API_KEY` or equivalent auth.

### M9-04 Real Claude run

**Issue:** [NGX-145](https://linear.app/ngxcalvin/issue/NGX-145)  
**Blocker:** No Claude CLI credentials available in this environment. The 120 s per-agent timeout may also require tuning for real workloads; this is documented as an open question in the issue.

### M9-05 Real OpenCode run

**Issue:** [NGX-146](https://linear.app/ngxcalvin/issue/NGX-146)  
**Blocker:** OpenCode CLI is not installed. `swarm doctor` will report this correctly when OpenCode is missing.

### M9-06 Mixed Claude + Codex run

**Issue:** [NGX-147](https://linear.app/ngxcalvin/issue/NGX-147)  
**Blocker:** Depends on M9-03 and M9-04; cannot be verified until both individual harness proofs pass.

### M9-10 Clean clone quickstart

**Issue:** [NGX-151](https://linear.app/ngxcalvin/issue/NGX-151)  
**Blocker:** Depends on at least one real harness (M9-03 or M9-04) to exercise the full README quickstart path.

---

## Release Decision

**NOT RELEASE READY.**

The 5 blocked gates above (NGX-144, NGX-145, NGX-146, NGX-147, NGX-151) all require real harness credentials or installations that are unavailable in this autonomous environment. No mocked-only evidence is presented as real-harness proof.

To unblock:

1. Set up Codex credentials and run `pnpm smoke:real --harness codex` → close NGX-144
2. Set up Claude credentials and run `pnpm smoke:real --harness claude` → close NGX-145
3. Install and auth OpenCode, run `pnpm smoke:real --harness opencode` → close NGX-146
4. Run a mixed swarm once both individual harnesses pass → close NGX-147
5. Verify README quickstart from a temp clone with working credentials → close NGX-151
6. Update this doc and flip the decision to RELEASE READY

All code, schema, infrastructure, and test gates (M9-01, M9-02, M9-07..M9-09, M9-11, all M10 issues) are complete and verified.
