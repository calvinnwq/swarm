import { z } from "zod";
import { RoundPacketSchema } from "./round-packet.js";

export const RunCheckpointSchema = z.object({
  runId: z.string().min(1),
  lastCompletedRound: z.int().min(1),
  priorPacket: RoundPacketSchema,
  orchestratorDirective: z.string().optional(),
  checkpointedAt: z.iso.datetime(),
  startedAt: z.iso.datetime(),
});

export type RunCheckpoint = z.infer<typeof RunCheckpointSchema>;
