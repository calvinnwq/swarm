import { extractJsonCandidates } from "../backends/json-output.js";
import {
  OrchestratorOutputSchema,
  type OrchestratorOutput,
} from "../schemas/index.js";

const orchestratorOutputKeys = [
  "round",
  "directive",
  "questionResolutions",
  "questionResolutionLimit",
  "deferredQuestions",
  "confidence",
] as const;

export function extractOrchestratorOutputJson(raw: string): unknown {
  const candidates = extractJsonCandidates(raw);
  if (candidates.length === 0) {
    return undefined;
  }

  for (const candidate of candidates) {
    if (OrchestratorOutputSchema.safeParse(candidate).success) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      orchestratorOutputKeys.some((key) => key in candidate)
    ) {
      return candidate;
    }
  }

  return candidates[0];
}

export type OrchestratorValidationResult =
  | { ok: true; output: OrchestratorOutput }
  | { ok: false; error: string };

export function validateOrchestratorOutput(
  stdout: string,
): OrchestratorValidationResult {
  const json = extractOrchestratorOutputJson(stdout);
  if (json === undefined) {
    return {
      ok: false,
      error: "Failed to extract JSON from orchestrator output",
    };
  }

  const parsed = OrchestratorOutputSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Schema validation failed: ${parsed.error.message}`,
    };
  }

  return { ok: true, output: parsed.data };
}

export function buildOrchestratorRepairPrompt(
  brief: string,
  validationError: string,
  invalidStdout: string,
): string {
  return `${brief}

Your previous orchestrator response could not be accepted.
Validation error: ${validationError}

Return only a single valid JSON object with exactly these required fields:
- round
- directive
- questionResolutions
- questionResolutionLimit
- deferredQuestions
- confidence

Do not include markdown fences, prose, or any text before/after the JSON.

Previous invalid response:
\`\`\`
${invalidStdout}
\`\`\``;
}
