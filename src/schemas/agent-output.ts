import { z } from "zod";

export const ConfidenceSchema = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

const stringList = z.array(z.string());

export const AgentOutputSchema = z
  .object({
    agent: z.string().min(1),
    round: z.int().min(0),
    stance: z.string(),
    recommendation: z.string(),
    reasoning: stringList,
    objections: stringList,
    risks: stringList,
    changesFromPriorRound: stringList,
    confidence: ConfidenceSchema,
    openQuestions: stringList,
  })
  .passthrough();

export type AgentOutput = z.infer<typeof AgentOutputSchema>;
