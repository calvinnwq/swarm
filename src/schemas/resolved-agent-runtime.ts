import { z } from "zod";
import { HarnessIdSchema } from "./harness-id.js";

export const HarnessResolutionSourceSchema = z.enum([
  "agent.harness",
  "agent.backend",
  "run.backend",
]);
export type HarnessResolutionSource = z.infer<
  typeof HarnessResolutionSourceSchema
>;

export const ModelResolutionSourceSchema = z.enum([
  "agent.model",
  "harness-default",
]);
export type ModelResolutionSource = z.infer<typeof ModelResolutionSourceSchema>;

export const ResolvedAgentRuntimeSchema = z
  .object({
    agentName: z.string().min(1),
    harness: HarnessIdSchema,
    model: z.string().min(1).nullable(),
    source: z.object({
      harness: HarnessResolutionSourceSchema,
      model: ModelResolutionSourceSchema,
    }),
  })
  .passthrough();

export type ResolvedAgentRuntime = z.infer<typeof ResolvedAgentRuntimeSchema>;
