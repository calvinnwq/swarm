import { z } from "zod";
import { ResolveModeSchema } from "./run-manifest.js";

const trimmedString = z.string().trim().min(1);

export const SwarmProjectConfigSchema = z
  .object({
    rounds: z.int().min(1).max(3).optional(),
    preset: trimmedString.optional(),
    agents: z.array(trimmedString).min(2).max(5).optional(),
    resolve: ResolveModeSchema.optional(),
    goal: trimmedString.optional(),
    decision: trimmedString.optional(),
    docs: z.array(trimmedString).optional(),
  })
  .strict();

export type SwarmProjectConfig = z.infer<typeof SwarmProjectConfigSchema>;
