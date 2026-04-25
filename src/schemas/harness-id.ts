import { z } from "zod";

export const HarnessIdSchema = z.enum(["claude", "codex", "opencode", "rovo"]);
export type HarnessId = z.infer<typeof HarnessIdSchema>;
