import { z } from "zod";
import { BackendIdSchema, type BackendId } from "./backend-id.js";

export const AgentBackendSchema = BackendIdSchema;
export type AgentBackend = BackendId;

const PromptRefSchema = z.union([
  z.string().min(1),
  z.object({ file: z.string().min(1) }).strict(),
]);
export type AgentPromptRef = z.infer<typeof PromptRefSchema>;

export const AgentDefinitionSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, {
        message: "name must be lowercase kebab/snake (a-z0-9_-)",
      }),
    description: z.string(),
    persona: z.string(),
    prompt: PromptRefSchema,
    backend: AgentBackendSchema.default("claude"),
  })
  .passthrough();

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
