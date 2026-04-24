import { z } from "zod";
import { RunStatusSchema, type RunStatus } from "./run-manifest.js";

export const RunEventKindSchema = z.enum([
  "run:started",
  "run:completed",
  "run:failed",
  "round:started",
  "round:completed",
  "scheduler:decision",
  "orchestrator:pass",
  "agent:started",
  "agent:completed",
  "agent:failed",
]);
export type RunEventKind = z.infer<typeof RunEventKindSchema>;

export const RunEventSchema = z.object({
  eventId: z.string().min(1),
  kind: RunEventKindSchema,
  runId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  roundNumber: z.int().min(1).optional(),
  agentName: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

// Allowed lifecycle state transitions.
// Key = current state, value = set of states it may transition to.
export const ALLOWED_RUN_STATUS_TRANSITIONS: Record<
  RunStatus,
  ReadonlySet<RunStatus>
> = {
  pending: new Set(["running", "failed"]),
  running: new Set(["done", "failed"]),
  done: new Set(),
  failed: new Set(),
};

export function isAllowedRunStatusTransition(
  from: RunStatus,
  to: RunStatus,
): boolean {
  return ALLOWED_RUN_STATUS_TRANSITIONS[from].has(to);
}
