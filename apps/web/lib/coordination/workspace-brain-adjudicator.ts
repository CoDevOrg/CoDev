import "server-only";

import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

import type { OverlapAdjudicator } from "./workspace-brain";

/**
 * The LLM half of duplicate-work detection. The brain's lexical prefilter
 * hands over every pair of agent goals that share enough vocabulary to be
 * worth a second look; this asks a model whether they are genuinely the
 * same piece of work — "fix the login bug" and "session cookie is dropped
 * on redirect" should come back as the same, "touch auth.ts" and "rename a
 * field in auth.ts" should not. Any failure here is swallowed by
 * `detectWorkspaceOverlaps`, which then falls back to a strict lexical
 * threshold, so this never has to be reliable to be safe.
 */

const verdictSchema = z.object({
  verdicts: z.array(
    z.object({
      leftSessionId: z.string(),
      rightSessionId: z.string(),
      sameWork: z.boolean(),
      confidence: z.number().min(0).max(1),
      rationale: z.string().max(400),
    }),
  ),
});

const SYSTEM_PROMPT = [
  "You compare pairs of software engineering tasks, each described by a goal",
  "and an approach. For every pair decide whether the two agents are doing",
  "the SAME work such that letting both continue in parallel would waste",
  "effort or cause a merge conflict.",
  "",
  "Same work: different wording for one outcome, one task that subsumes the",
  "other, or two agents independently fixing the same defect.",
  "Not the same work: same file or feature area but distinct changes,",
  "complementary halves of a larger effort, or a shared dependency only.",
  "",
  "Return one verdict per input pair, echoing leftSessionId and",
  "rightSessionId exactly. confidence is 0..1. rationale is one sentence.",
].join("\n");

export function createModelOverlapAdjudicator(
  model: LanguageModel,
): OverlapAdjudicator {
  return async (pairs) => {
    if (!pairs.length) return [];
    const { object } = await generateObject({
      model,
      schema: verdictSchema,
      system: SYSTEM_PROMPT,
      prompt: JSON.stringify({ pairs }, null, 2),
    });
    const wanted = new Set(
      pairs.map((pair) => `${pair.leftSessionId}:${pair.rightSessionId}`),
    );
    return object.verdicts.filter((verdict) =>
      wanted.has(`${verdict.leftSessionId}:${verdict.rightSessionId}`),
    );
  };
}
