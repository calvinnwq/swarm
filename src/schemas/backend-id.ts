import { z } from "zod";

export const BackendIdSchema = z.enum(["claude"]);
export type BackendId = z.infer<typeof BackendIdSchema>;
