import { describe, expect, it } from "vitest";
import { MessageEnvelopeSchema } from "../../../src/schemas/index.js";

const validEnvelope = {
  messageId: "msg-001",
  senderId: "orchestrator",
  recipients: ["agent-alpha"],
  kind: "task" as const,
  payload: { topic: "discuss tradeoffs" },
  deliveryStatus: "staged" as const,
  createdAt: "2026-04-24T00:00:00.000Z",
};

describe("MessageEnvelopeSchema", () => {
  it("accepts a minimal valid envelope", () => {
    const parsed = MessageEnvelopeSchema.parse(validEnvelope);
    expect(parsed.messageId).toBe("msg-001");
    expect(parsed.senderId).toBe("orchestrator");
    expect(parsed.deliveryStatus).toBe("staged");
    expect(parsed.parentId).toBeUndefined();
    expect(parsed.causationId).toBeUndefined();
    expect(parsed.roundNumber).toBeUndefined();
  });

  it("accepts broadcast recipient", () => {
    const parsed = MessageEnvelopeSchema.parse({
      ...validEnvelope,
      kind: "broadcast",
      recipients: ["broadcast"],
    });
    expect(parsed.recipients).toEqual(["broadcast"]);
  });

  it("accepts multiple recipients including orchestrator", () => {
    const parsed = MessageEnvelopeSchema.parse({
      ...validEnvelope,
      recipients: ["agent-alpha", "orchestrator"],
    });
    expect(parsed.recipients).toHaveLength(2);
  });

  it("accepts parentId and causationId for causal threading", () => {
    const parsed = MessageEnvelopeSchema.parse({
      ...validEnvelope,
      parentId: "msg-000",
      causationId: "msg-000",
    });
    expect(parsed.parentId).toBe("msg-000");
    expect(parsed.causationId).toBe("msg-000");
  });

  it("accepts committed delivery status", () => {
    const parsed = MessageEnvelopeSchema.parse({
      ...validEnvelope,
      deliveryStatus: "committed",
    });
    expect(parsed.deliveryStatus).toBe("committed");
  });

  it("accepts roundNumber", () => {
    const parsed = MessageEnvelopeSchema.parse({
      ...validEnvelope,
      roundNumber: 2,
    });
    expect(parsed.roundNumber).toBe(2);
  });

  it("rejects empty recipients list", () => {
    expect(
      MessageEnvelopeSchema.safeParse({ ...validEnvelope, recipients: [] })
        .success,
    ).toBe(false);
  });

  it("rejects unknown kind", () => {
    expect(
      MessageEnvelopeSchema.safeParse({ ...validEnvelope, kind: "unknown" })
        .success,
    ).toBe(false);
  });

  it("rejects unknown deliveryStatus", () => {
    expect(
      MessageEnvelopeSchema.safeParse({
        ...validEnvelope,
        deliveryStatus: "pending",
      }).success,
    ).toBe(false);
  });

  it("rejects missing required fields", () => {
    const { messageId: _, ...rest } = validEnvelope;
    expect(MessageEnvelopeSchema.safeParse(rest).success).toBe(false);
  });
});
