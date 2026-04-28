import { AgentOutputSchema } from "../schemas/index.js";

const PartialAgentOutputSchema = AgentOutputSchema.partial();
const agentOutputKeys = [
  "agent",
  "round",
  "stance",
  "recommendation",
  "reasoning",
  "objections",
  "risks",
  "changesFromPriorRound",
  "confidence",
  "openQuestions",
] as const;

function isAgentOutputLike(candidate: unknown): boolean {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Array.isArray(candidate) ||
    !PartialAgentOutputSchema.safeParse(candidate).success
  ) {
    return false;
  }

  return agentOutputKeys.some((key) => key in candidate);
}

export function extractJson(raw: string): unknown {
  return extractJsonCandidates(raw)[0];
}

export function extractJsonCandidates(raw: string): unknown[] {
  const trimmed = raw.trim();
  const candidates: Array<{ start: number; value: unknown }> = [];

  try {
    candidates.push({ start: 0, value: JSON.parse(trimmed) });
  } catch {
    // fall through
  }

  const fenceRe = /```(?:json)?\s*\n([\s\S]*?)```/;
  const fenceMatch = fenceRe.exec(trimmed);
  if (fenceMatch) {
    try {
      candidates.push({
        start: fenceMatch.index,
        value: JSON.parse(fenceMatch[1].trim()),
      });
    } catch {
      // fall through
    }
  }

  for (
    let start = trimmed.indexOf("{");
    start !== -1;
    start = trimmed.indexOf("{", start + 1)
  ) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < trimmed.length; i += 1) {
      const char = trimmed[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth += 1;
        continue;
      }

      if (char !== "}") {
        continue;
      }

      depth -= 1;
      if (depth !== 0) {
        continue;
      }

      try {
        candidates.push({
          start,
          value: JSON.parse(trimmed.slice(start, i + 1)),
        });
        break;
      } catch {
        break;
      }
    }
  }

  return candidates
    .sort((left, right) => left.start - right.start)
    .map((candidate) => candidate.value);
}

export function extractAgentOutputJson(raw: string): unknown {
  const candidates = extractJsonCandidates(raw);
  if (candidates.length === 0) {
    return undefined;
  }

  for (const candidate of candidates) {
    if (AgentOutputSchema.safeParse(candidate).success) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (isAgentOutputLike(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}
