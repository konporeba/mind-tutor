// Grounding judge verdict contract (test-plan Phase 4).
//
// The structured shape the LLM judge must return: one entry per ATOMIC factual
// claim it extracted from the submitted prose, each marked grounded or not against
// the source. Like generation/schema.ts, this is the single source of truth the
// judge parses + zod-validates the model response against — a malformed or
// off-contract verdict is a clean typed failure (GroundingError), never a silent
// pass. `field` is the type-level origin of the claim (which prose surface it came
// from); distractors are never submitted, so there is no distractor field.

import { z } from "zod";

/** The gradable prose surfaces. Excludes theory[].citation (Phase 1's structural
 *  findUngroundedCitation owns that — §4 "When NOT to use the judge") and MCQ
 *  distractors (intentionally off-source — only the correct option is graded). */
export const GROUNDING_FIELDS = [
  "title",
  "theory.heading",
  "theory.body",
  "mcq.prompt",
  "mcq.correctOption",
  "mcq.feedback",
] as const;

export const ClaimVerdictSchema = z.object({
  field: z.enum(GROUNDING_FIELDS),
  claim: z.string().min(1),
  grounded: z.boolean(),
  sourceSpan: z.string().nullable(),
  reasoning: z.string().min(1),
});

export const GroundingVerdictSchema = z.object({
  claims: z.array(ClaimVerdictSchema),
});

export type GroundingField = (typeof GROUNDING_FIELDS)[number];
export type ClaimVerdict = z.infer<typeof ClaimVerdictSchema>;
export type GroundingVerdict = z.infer<typeof GroundingVerdictSchema>;
