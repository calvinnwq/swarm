import { z } from "zod";

export const BackendIdSchema = z.enum(["claude", "codex"]);
export type BackendId = z.infer<typeof BackendIdSchema>;
