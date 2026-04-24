import { z } from "zod";

export const MessageDeliveryStatusSchema = z.enum(["staged", "committed"]);
export type MessageDeliveryStatus = z.infer<typeof MessageDeliveryStatusSchema>;

export const MessageKindSchema = z.enum(["task", "response", "broadcast", "system"]);
export type MessageKind = z.infer<typeof MessageKindSchema>;

// Senders: named agents, the orchestrator, or the runtime system
export const MessageSenderSchema = z.string().min(1);
export type MessageSender = z.infer<typeof MessageSenderSchema>;

// Recipients: named agents, the orchestrator, or "broadcast" for all
export const MessageRecipientSchema = z.union([
  z.string().min(1),
  z.literal("broadcast"),
  z.literal("orchestrator"),
]);
export type MessageRecipient = z.infer<typeof MessageRecipientSchema>;

export const MessageEnvelopeSchema = z.object({
  messageId: z.string().min(1),
  // Causal chain: parentId threads a reply to a prior message, causationId traces the root cause
  parentId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  senderId: MessageSenderSchema,
  recipients: z.array(MessageRecipientSchema).min(1),
  kind: MessageKindSchema,
  payload: z.record(z.string(), z.unknown()),
  deliveryStatus: MessageDeliveryStatusSchema,
  createdAt: z.iso.datetime(),
  roundNumber: z.int().min(1).optional(),
});

export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>;
