import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentOutput, RunManifest } from "../schemas/index.js";
import type { AgentResult, RoundResult } from "./round-runner.js";
import type { SynthesisResult } from "./synthesis.js";

/**
 * Derive a filesystem-safe slug from a topic string.
 * Lowercases, replaces non-alphanumeric runs with hyphens, trims hyphens.
 */
export function slugify(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build the run directory name: YYYYMMDD-HHMMSS-<slug>
 */
export function buildRunDirName(startedAt: Date, topic: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = [
    startedAt.getUTCFullYear(),
    pad(startedAt.getUTCMonth() + 1),
    pad(startedAt.getUTCDate()),
  ].join("");
  const time = [
    pad(startedAt.getUTCHours()),
    pad(startedAt.getUTCMinutes()),
    pad(startedAt.getUTCSeconds()),
  ].join("");
  return `${date}-${time}-${slugify(topic)}`;
}

/**
 * Render a single agent's output as a markdown file matching the reference layout.
 *
 * Format:
 *   YAML-ish header (Agent, Round, Status, Exit code, Timed out, Duration seconds, Wrapper)
 *   Sections: Stance, Recommendation, Reasoning, Objections, Risks,
 *             Changes From Prior Round, Confidence, Open Questions
 *   ## Raw Output code block
 */
export function renderAgentMarkdown(
  result: AgentResult,
  round: number,
  wrapperName = "claude-cli",
): string {
  const lines: string[] = [];

  const status = result.ok ? "ok" : "failed";
  const exitCode = result.raw?.exitCode ?? (result.ok ? 0 : 1);
  const timedOut = result.raw?.timedOut ?? false;
  const durationMs = result.raw?.durationMs ?? 0;
  const durationSeconds = (durationMs / 1000).toFixed(1);

  // Header
  lines.push(`Agent: ${result.agent}`);
  lines.push(`Round: ${round}`);
  lines.push(`Status: ${status}`);
  lines.push(`Exit code: ${exitCode}`);
  lines.push(`Timed out: ${timedOut}`);
  lines.push(`Duration seconds: ${durationSeconds}`);
  lines.push(`Wrapper: ${wrapperName}`);
  lines.push("");

  if (!result.ok || !result.output) {
    lines.push("## Error");
    lines.push("");
    lines.push(result.error ?? "Unknown error");
    lines.push("");

    if (result.raw?.stdout) {
      lines.push("## Raw Output");
      lines.push("");
      lines.push("```");
      lines.push(result.raw.stdout);
      lines.push("```");
      lines.push("");
    }

    return lines.join("\n");
  }

  const o: AgentOutput = result.output;

  lines.push("## Stance");
  lines.push("");
  lines.push(o.stance);
  lines.push("");

  lines.push("## Recommendation");
  lines.push("");
  lines.push(o.recommendation);
  lines.push("");

  lines.push("## Reasoning");
  lines.push("");
  for (const r of o.reasoning) {
    lines.push(`- ${r}`);
  }
  lines.push("");

  lines.push("## Objections");
  lines.push("");
  if (o.objections.length === 0) {
    lines.push("None.");
  } else {
    for (const obj of o.objections) {
      lines.push(`- ${obj}`);
    }
  }
  lines.push("");

  lines.push("## Risks");
  lines.push("");
  if (o.risks.length === 0) {
    lines.push("None.");
  } else {
    for (const risk of o.risks) {
      lines.push(`- ${risk}`);
    }
  }
  lines.push("");

  lines.push("## Changes From Prior Round");
  lines.push("");
  if (o.changesFromPriorRound.length === 0) {
    lines.push("None.");
  } else {
    for (const change of o.changesFromPriorRound) {
      lines.push(`- ${change}`);
    }
  }
  lines.push("");

  lines.push("## Confidence");
  lines.push("");
  lines.push(o.confidence);
  lines.push("");

  lines.push("## Open Questions");
  lines.push("");
  if (o.openQuestions.length === 0) {
    lines.push("None.");
  } else {
    for (const q of o.openQuestions) {
      lines.push(`- ${q}`);
    }
  }
  lines.push("");

  // Raw output
  lines.push("## Raw Output");
  lines.push("");
  lines.push("```");
  lines.push(result.raw?.stdout ?? "");
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

export interface ArtifactWriterOpts {
  /** Base directory for runs, e.g. ".swarm/runs" */
  baseDir: string;
  /** The run manifest */
  manifest: RunManifest;
  /** Seed brief markdown */
  seedBrief: string;
  /** Human-readable backend wrapper label for per-agent artifacts */
  wrapperName?: string;
}

/**
 * Artifact writer that persists a swarm run to disk.
 *
 * Writes incrementally: each round is flushed as soon as it completes,
 * so a crashed run still has partial artifacts.
 */
export class ArtifactWriter {
  readonly runDir: string;

  constructor(private opts: ArtifactWriterOpts) {
    this.runDir = opts.manifest.runDir;
  }

  /**
   * Initialize the run directory with manifest and seed brief.
   */
  init(): void {
    mkdirSync(this.runDir, { recursive: true });
    writeFileSync(
      join(this.runDir, "manifest.json"),
      JSON.stringify(this.opts.manifest, null, 2) + "\n",
    );
    writeFileSync(join(this.runDir, "seed-brief.md"), this.opts.seedBrief);
  }

  /**
   * Write all artifacts for a completed round.
   */
  writeRound(roundResult: RoundResult, brief: string): void {
    const roundDir = join(
      this.runDir,
      `round-${String(roundResult.round).padStart(2, "0")}`,
    );
    const agentsDir = join(roundDir, "agents");
    mkdirSync(agentsDir, { recursive: true });

    // Round brief
    writeFileSync(join(roundDir, "brief.md"), brief);

    // Per-agent markdown
    for (const result of roundResult.agentResults) {
      const md = renderAgentMarkdown(
        result,
        roundResult.round,
        this.opts.wrapperName ?? "claude-cli",
      );
      writeFileSync(join(agentsDir, `${result.agent}.md`), md);
    }
  }

  /**
   * Write synthesis artifacts after all rounds complete.
   */
  writeSynthesis(synthesis: SynthesisResult): void {
    writeFileSync(
      join(this.runDir, "synthesis.json"),
      JSON.stringify(synthesis.json, null, 2) + "\n",
    );
    writeFileSync(join(this.runDir, "synthesis.md"), synthesis.markdown);
  }

  /**
   * Update the manifest with finishedAt timestamp.
   */
  finalize(finishedAt: string): void {
    const updated = { ...this.opts.manifest, finishedAt };
    writeFileSync(
      join(this.runDir, "manifest.json"),
      JSON.stringify(updated, null, 2) + "\n",
    );
  }
}

/**
 * Create an ArtifactWriter with the standard .swarm/runs layout.
 */
export function createArtifactWriter(opts: ArtifactWriterOpts): ArtifactWriter {
  return new ArtifactWriter(opts);
}
