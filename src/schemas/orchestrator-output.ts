import { z } from "zod";
import { ConfidenceSchema } from "./agent-output.js";
import { QuestionResolutionSchema } from "./round-packet.js";

const stringList = z.array(z.string());

export const OrchestratorOutputSchema = z
  .object({
    round: z.int().min(0),
    directive: z.string(),
    questionResolutions: z.array(QuestionResolutionSchema),
    questionResolutionLimit: z.int().min(0),
    deferredQuestions: stringList,
    confidence: ConfidenceSchema,
  })
  .passthrough();

export type OrchestratorOutput = z.infer<typeof OrchestratorOutputSchema>;
