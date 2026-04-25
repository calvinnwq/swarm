import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  RunCheckpointSchema,
  type RunCheckpoint,
} from "../schemas/run-checkpoint.js";

const CHECKPOINT_FILE = "checkpoint.json";
const CHECKPOINT_TMP_FILE = "checkpoint.json.tmp";

/**
 * Atomic checkpoint writer for durable round recovery boundaries.
 *
 * Each write uses a write-then-rename pattern so readers never observe a
 * partially-written file: the checkpoint is written to a `.tmp` file first
 * and then atomically renamed to `checkpoint.json`.
 *
 * A checkpoint captures the last fully committed round, the prior-round
 * packet needed to rebuild briefs, and the orchestrator directive so a
 * resumed run can continue from exactly where it left off.
 */
export class CheckpointWriter {
  readonly checkpointPath: string;
  private readonly tmpPath: string;

  constructor(readonly runDir: string) {
    this.checkpointPath = join(runDir, CHECKPOINT_FILE);
    this.tmpPath = join(runDir, CHECKPOINT_TMP_FILE);
  }

  /**
   * Validate and atomically write a checkpoint.
   * The file is Zod-validated before writing; throws ZodError on invalid input.
   */
  write(checkpoint: RunCheckpoint): void {
    RunCheckpointSchema.parse(checkpoint);
    writeFileSync(this.tmpPath, JSON.stringify(checkpoint, null, 2));
    renameSync(this.tmpPath, this.checkpointPath);
  }

  /**
   * Read and parse the current checkpoint.
   * Returns null if no checkpoint exists or the file cannot be parsed.
   */
  read(): RunCheckpoint | null {
    try {
      const content = readFileSync(this.checkpointPath, "utf-8");
      return RunCheckpointSchema.parse(JSON.parse(content));
    } catch {
      return null;
    }
  }
}
