import { z } from "zod";
import { AgentOutputSchema } from "./agent-output.js";
import { OrchestratorOutputSchema } from "./orchestrator-output.js";
import { RoundPacketSchema } from "./round-packet.js";

const CheckpointAgentResultSchema = z.object({
  agent: z.string().min(1),
  ok: z.boolean(),
  output: AgentOutputSchema.nullable(),
  error: z.string().nullable(),
});

const CheckpointRoundResultSchema = z.object({
  round: z.int().min(1),
  agentResults: z.array(CheckpointAgentResultSchema),
  packet: RoundPacketSchema,
});

export const OrchestratorPassRecordSchema = z.object({
  round: z.int().min(1),
  agentName: z.string().min(1),
  output: OrchestratorOutputSchema,
});

export type OrchestratorPassRecord = z.infer<
  typeof OrchestratorPassRecordSchema
>;

export const RunCheckpointSchema = z.object({
  runId: z.string().min(1),
  lastCompletedRound: z.int().min(1),
  priorPacket: RoundPacketSchema,
  completedRoundPackets: z.array(RoundPacketSchema).optional(),
  completedRoundResults: z.array(CheckpointRoundResultSchema).optional(),
  orchestratorDirective: z.string().optional(),
  orchestratorPasses: z.array(OrchestratorPassRecordSchema).optional(),
  pendingBetweenRounds: z.boolean().optional(),
  checkpointedAt: z.iso.datetime(),
  startedAt: z.iso.datetime(),
});

export type RunCheckpoint = z.infer<typeof RunCheckpointSchema>;
