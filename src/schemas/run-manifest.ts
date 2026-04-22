import { z } from "zod";
import { BackendIdSchema } from "./backend-id.js";

export const ResolveModeSchema = z.enum(["off", "orchestrator", "agents"]);
export type ResolveMode = z.infer<typeof ResolveModeSchema>;

export const RunManifestSchema = z
  .object({
    topic: z.string().min(1),
    rounds: z.int().min(1),
    backend: BackendIdSchema,
    preset: z.string().nullable().optional(),
    goal: z.string().nullable().optional(),
    decision: z.string().nullable().optional(),
    agents: z.array(z.string()).min(1),
    resolveMode: ResolveModeSchema,
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().optional(),
    runDir: z.string().min(1),
  })
  .passthrough();

export type RunManifest = z.infer<typeof RunManifestSchema>;
