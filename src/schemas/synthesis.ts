import { z } from "zod";
import { ConfidenceSchema } from "./agent-output.js";

const stringList = z.array(z.string());

export const StanceTallySchema = z.object({
  stance: z.string(),
  agents: stringList,
  count: z.int().min(1),
});
export type StanceTally = z.infer<typeof StanceTallySchema>;

export const SynthesisSchema = z
  .object({
    topic: z.string(),
    rounds: z.int().min(1),
    agents: stringList,
    resolveMode: z.string(),
    consensus: z.boolean(),
    stanceTally: z.array(StanceTallySchema),
    topRecommendation: z.string(),
    topRecommendationBasis: stringList,
    sharedRisks: stringList,
    keyObjections: stringList,
    openQuestions: stringList,
    deferredQuestions: stringList,
    overallConfidence: ConfidenceSchema,
    roundCount: z.int().min(1),
    agentCount: z.int().min(1),
  })
  .passthrough();

export type SynthesisJson = z.infer<typeof SynthesisSchema>;
