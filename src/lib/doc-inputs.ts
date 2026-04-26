import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { z } from "zod";
import { SwarmCommandError, dedupeKeepOrder } from "./parse-command.js";

export interface ResolveCarryForwardDocsOptions {
  cwd?: string;
}

export async function resolveCarryForwardDocs(
  docs: readonly string[],
  options: ResolveCarryForwardDocsOptions = {},
): Promise<string[]> {
  const resolvedDocs = await resolveCarryForwardDocPaths(docs, options);
  return resolvedDocs.map((doc) => doc.displayPath);
}

export interface MaterializeCarryForwardDocPacketsOptions extends ResolveCarryForwardDocsOptions {
  maxCharsPerDoc?: number;
}

export interface CarryForwardDocPacket {
  path: string;
  content: string;
  originalCharCount: number;
  includedCharCount: number;
  truncated: boolean;
  provenance: CarryForwardDocProvenance;
}

export interface CarryForwardDocProvenance {
  absolutePath: string;
  excerptStart: number;
  excerptEnd: number;
  sha256: string;
  mtimeMs: number;
}

const CarryForwardDocSnapshotManifestSchema = z.object({
  docs: z.array(
    z.object({
      index: z.number().int().positive(),
      path: z.string(),
      snapshotPath: z.string(),
      originalCharCount: z.number().int().nonnegative(),
      includedCharCount: z.number().int().nonnegative(),
      truncated: z.boolean(),
      provenance: z.object({
        absolutePath: z.string(),
        excerptStart: z.number().int().nonnegative(),
        excerptEnd: z.number().int().nonnegative(),
        sha256: z.string(),
        mtimeMs: z.number(),
      }),
    }),
  ),
});

export async function materializeCarryForwardDocPackets(
  docs: readonly string[],
  options: MaterializeCarryForwardDocPacketsOptions = {},
): Promise<CarryForwardDocPacket[]> {
  const maxCharsPerDoc = options.maxCharsPerDoc ?? 4_000;
  if (!Number.isInteger(maxCharsPerDoc) || maxCharsPerDoc < 1) {
    throw new SwarmCommandError(
      "carry-forward doc packet size must be a positive integer",
    );
  }

  const resolvedDocs = await resolveCarryForwardDocPaths(docs, options);
  return Promise.all(
    resolvedDocs.map(async (doc) => {
      const content = await readFile(doc.absolutePath, "utf-8");
      const info = await stat(doc.absolutePath);
      const excerpt = content.slice(0, maxCharsPerDoc);
      return {
        path: doc.displayPath,
        content: excerpt,
        originalCharCount: content.length,
        includedCharCount: excerpt.length,
        truncated: excerpt.length < content.length,
        provenance: {
          absolutePath: doc.absolutePath,
          excerptStart: 0,
          excerptEnd: excerpt.length,
          sha256: createHash("sha256").update(content).digest("hex"),
          mtimeMs: info.mtimeMs,
        },
      };
    }),
  );
}

export async function loadCarryForwardDocSnapshots(
  runDir: string,
): Promise<CarryForwardDocPacket[]> {
  const snapshotDir = path.join(runDir, "carry-forward-docs");
  const manifestPath = path.join(snapshotDir, "manifest.json");

  let content: string;
  try {
    content = await readFile(manifestPath, "utf-8");
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new SwarmCommandError(
      `carry-forward doc snapshot manifest is not readable: ${message}`,
    );
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SwarmCommandError(
      `carry-forward doc snapshot manifest is invalid JSON: ${message}`,
    );
  }

  const parsed = CarryForwardDocSnapshotManifestSchema.safeParse(manifestJson);
  if (!parsed.success) {
    throw new SwarmCommandError(
      `carry-forward doc snapshot manifest is invalid: ${parsed.error.message}`,
    );
  }

  return Promise.all(
    parsed.data.docs.map(async (doc) => {
      const snapshotPath = resolveSnapshotPath(snapshotDir, doc.snapshotPath);
      let snapshotContent: string;
      try {
        snapshotContent = await readFile(snapshotPath, "utf-8");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new SwarmCommandError(
          `carry-forward doc snapshot is not readable: ${doc.snapshotPath}: ${message}`,
        );
      }

      return {
        path: doc.path,
        content: snapshotContent,
        originalCharCount: doc.originalCharCount,
        includedCharCount: doc.includedCharCount,
        truncated: doc.truncated,
        provenance: doc.provenance,
      };
    }),
  );
}

async function resolveCarryForwardDocPaths(
  docs: readonly string[],
  options: ResolveCarryForwardDocsOptions = {},
): Promise<ResolvedDocPath[]> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const resolved = docs
    .map((doc) => resolveDocPath(doc, cwd))
    .filter((doc): doc is ResolvedDocPath => doc !== null);

  const deduped = dedupeKeepOrder(resolved.map((doc) => doc.absolutePath)).map(
    (absolutePath) => {
      const doc = resolved.find((candidate) => {
        return candidate.absolutePath === absolutePath;
      });
      if (!doc) {
        throw new SwarmCommandError(
          `failed to resolve carry-forward doc: ${absolutePath}`,
        );
      }
      return doc;
    },
  );

  for (const doc of deduped) {
    await validateDocPath(doc);
  }

  return deduped;
}

interface ResolvedDocPath {
  absolutePath: string;
  displayPath: string;
}

function resolveDocPath(rawDoc: string, cwd: string): ResolvedDocPath | null {
  const trimmed = rawDoc.trim();
  if (!trimmed) {
    return null;
  }

  const absolutePath = path.resolve(cwd, trimmed);
  return {
    absolutePath,
    displayPath: displayPathFor(absolutePath, cwd),
  };
}

function displayPathFor(absolutePath: string, cwd: string): string {
  const relativePath = path.relative(cwd, absolutePath);
  if (
    relativePath &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  ) {
    return normalizeSeparators(relativePath);
  }
  return normalizeSeparators(absolutePath);
}

function normalizeSeparators(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function resolveSnapshotPath(
  snapshotDir: string,
  snapshotPath: string,
): string {
  const absoluteSnapshotDir = path.resolve(snapshotDir);
  const absoluteSnapshotPath = path.resolve(absoluteSnapshotDir, snapshotPath);
  const relativeSnapshotPath = path.relative(
    absoluteSnapshotDir,
    absoluteSnapshotPath,
  );
  if (
    !relativeSnapshotPath ||
    relativeSnapshotPath.startsWith("..") ||
    path.isAbsolute(relativeSnapshotPath)
  ) {
    throw new SwarmCommandError(
      `carry-forward doc snapshot path escapes snapshot directory: ${snapshotPath}`,
    );
  }
  return absoluteSnapshotPath;
}

async function validateDocPath(doc: ResolvedDocPath): Promise<void> {
  try {
    await access(doc.absolutePath, constants.R_OK);
  } catch (error) {
    if (isMissingFile(error)) {
      throw new SwarmCommandError(
        `carry-forward doc not found: ${doc.displayPath}`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new SwarmCommandError(
      `carry-forward doc is not readable: ${doc.displayPath}: ${message}`,
    );
  }

  const info = await stat(doc.absolutePath);
  if (!info.isFile()) {
    throw new SwarmCommandError(
      `carry-forward doc is not a file: ${doc.displayPath}`,
    );
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
