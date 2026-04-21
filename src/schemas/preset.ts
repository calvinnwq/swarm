import { z } from "zod";
import { ResolveModeSchema } from "./run-manifest.js";

const trimmedString = z.string().trim().min(1);

export const SwarmPresetSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, {
        message: "name must be lowercase kebab/snake (a-z0-9_-)",
      }),
    description: trimmedString.optional(),
    agents: z.array(trimmedString).min(2).max(5),
    resolve: ResolveModeSchema.optional(),
    goal: trimmedString.optional(),
    decision: trimmedString.optional(),
  })
  .strict();

export type SwarmPreset = z.infer<typeof SwarmPresetSchema>;
