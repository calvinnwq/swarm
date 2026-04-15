import { z } from "zod";
import { ConfidenceSchema } from "./agent-output.js";

const stringList = z.array(z.string());

export const RoundSummarySchema = z
  .object({
    agent: z.string(),
    stance: z.string(),
    recommendation: z.string(),
    objections: stringList,
    risks: stringList,
    confidence: ConfidenceSchema,
    openQuestions: stringList,
  })
  .passthrough();

export type RoundSummary = z.infer<typeof RoundSummarySchema>;

export const QuestionResolutionStatusSchema = z.enum([
  "consensus",
  "directional",
  "deferred",
]);
export type QuestionResolutionStatus = z.infer<
  typeof QuestionResolutionStatusSchema
>;

export const QuestionResolutionSchema = z
  .object({
    question: z.string(),
    status: QuestionResolutionStatusSchema,
    answer: z.string(),
    basis: z.string(),
    confidence: ConfidenceSchema,
    askedBy: stringList,
    supportingAgents: stringList,
    supportingReasoning: stringList,
    relatedObjections: stringList,
    relatedRisks: stringList,
    blockingScore: z.int().min(0),
  })
  .passthrough();

export type QuestionResolution = z.infer<typeof QuestionResolutionSchema>;

export const RoundPacketSchema = z
  .object({
    round: z.int().min(0).nullable(),
    agents: stringList,
    summaries: z.array(RoundSummarySchema),
    keyObjections: stringList,
    sharedRisks: stringList,
    openQuestions: stringList,
    questionResolutions: z.array(QuestionResolutionSchema),
    questionResolutionLimit: z.int().min(0),
    deferredQuestions: stringList,
  })
  .passthrough();

export type RoundPacket = z.infer<typeof RoundPacketSchema>;
