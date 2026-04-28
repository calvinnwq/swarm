import { join } from "node:path";
import {
  MessageEnvelopeSchema,
  RunCheckpointSchema,
  RunEventSchema,
  RunManifestSchema,
  SynthesisSchema,
} from "../schemas/index.js";
import type { RunManifest, RunCheckpoint } from "../schemas/index.js";

export interface ArtifactValidationError {
  path: string;
  message: string;
}

export interface ArtifactValidationResult {
  ok: boolean;
  errors: ArtifactValidationError[];
}

export interface ArtifactValidatorDeps {
  readFile: (path: string) => string;
  fileExists: (path: string) => boolean;
}

function tryReadJson(
  filePath: string,
  deps: ArtifactValidatorDeps,
  errors: ArtifactValidationError[],
): unknown | undefined {
  let content: string;
  try {
    content = deps.readFile(filePath);
  } catch {
    errors.push({ path: filePath, message: "file not found or unreadable" });
    return undefined;
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    errors.push({ path: filePath, message: "invalid JSON" });
    return undefined;
  }
}

function validateJsonlFile<
  S extends {
    safeParse: (v: unknown) => {
      success: boolean;
      error?: { message: string };
    };
  },
>(
  filePath: string,
  schema: S,
  deps: ArtifactValidatorDeps,
  errors: ArtifactValidationError[],
): void {
  let content: string;
  try {
    content = deps.readFile(filePath);
  } catch {
    errors.push({ path: filePath, message: "file not found or unreadable" });
    return;
  }
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  for (let i = 0; i < lines.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]!);
    } catch {
      errors.push({ path: filePath, message: `line ${i + 1}: invalid JSON` });
      continue;
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      errors.push({
        path: filePath,
        message: `line ${i + 1}: schema validation failed: ${result.error?.message ?? "unknown"}`,
      });
    }
  }
}

export function validateRunArtifacts(
  runDir: string,
  deps: ArtifactValidatorDeps,
): ArtifactValidationResult {
  const errors: ArtifactValidationError[] = [];
  const p = (name: string) => join(runDir, name);

  // Validate manifest.json
  let manifest: RunManifest | undefined;
  const manifestRaw = tryReadJson(p("manifest.json"), deps, errors);
  if (manifestRaw !== undefined) {
    const r = RunManifestSchema.safeParse(manifestRaw);
    if (!r.success) {
      errors.push({
        path: p("manifest.json"),
        message: `schema validation failed: ${r.error.message}`,
      });
    } else {
      manifest = r.data;
    }
  }

  // Validate checkpoint.json
  let checkpoint: RunCheckpoint | undefined;
  const checkpointRaw = tryReadJson(p("checkpoint.json"), deps, errors);
  if (checkpointRaw !== undefined) {
    const r = RunCheckpointSchema.safeParse(checkpointRaw);
    if (!r.success) {
      errors.push({
        path: p("checkpoint.json"),
        message: `schema validation failed: ${r.error.message}`,
      });
    } else {
      checkpoint = r.data;
    }
  }

  // Cross-check runId consistency
  if (manifest && checkpoint && manifest.runId !== checkpoint.runId) {
    errors.push({
      path: p("checkpoint.json"),
      message: `runId mismatch: manifest has '${manifest.runId}', checkpoint has '${checkpoint.runId}'`,
    });
  }

  // Validate events.jsonl
  validateJsonlFile(p("events.jsonl"), RunEventSchema, deps, errors);

  // Validate messages.jsonl
  validateJsonlFile(p("messages.jsonl"), MessageEnvelopeSchema, deps, errors);

  // Check required plain-text files
  if (!deps.fileExists(p("seed-brief.md"))) {
    errors.push({ path: p("seed-brief.md"), message: "file not found" });
  }

  const rounds =
    manifest === undefined
      ? 0
      : manifest.status === "done"
        ? manifest.rounds
        : (checkpoint?.lastCompletedRound ?? 0);
  for (let r = 1; r <= rounds; r++) {
    const roundDir = `round-${String(r).padStart(2, "0")}`;
    const briefPath = p(`${roundDir}/brief.md`);
    if (!deps.fileExists(briefPath)) {
      errors.push({ path: briefPath, message: "file not found" });
    }

    const checkpointRound = checkpoint?.completedRoundResults?.find(
      (roundResult) => roundResult.round === r,
    );
    const agentNames =
      checkpointRound?.agentResults.map((agentResult) => agentResult.agent) ??
      manifest?.agents ??
      [];
    for (const agentName of agentNames) {
      const agentPath = p(`${roundDir}/agents/${agentName}.md`);
      if (!deps.fileExists(agentPath)) {
        errors.push({ path: agentPath, message: "file not found" });
      }
    }
  }

  // Validate synthesis.json if present (optional for in-progress runs)
  const synthPath = p("synthesis.json");
  if (deps.fileExists(synthPath)) {
    const synthRaw = tryReadJson(synthPath, deps, errors);
    if (synthRaw !== undefined) {
      const r = SynthesisSchema.safeParse(synthRaw);
      if (!r.success) {
        errors.push({
          path: synthPath,
          message: `schema validation failed: ${r.error.message}`,
        });
      }
    }
  }
  if (manifest?.status === "done") {
    if (!deps.fileExists(synthPath)) {
      errors.push({ path: synthPath, message: "file not found" });
    }
    const synthMarkdownPath = p("synthesis.md");
    if (!deps.fileExists(synthMarkdownPath)) {
      errors.push({ path: synthMarkdownPath, message: "file not found" });
    }
  }

  return { ok: errors.length === 0, errors };
}
