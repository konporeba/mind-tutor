// Test fixtures + builders for the generation service (test-plan Phase 1).
//
// `generateSession` validates the model's JSON against a sizing-derived schema and
// checks that every theory citation is a verbatim span of the source it sent. These
// builders produce a KNOWN-GOOD session for a given intake's sizing, with citations
// that are real substrings of the source — so each failure-mode / grounding case is a
// one-line override off this baseline. We assert structure + grounding, never values
// lifted from a real model (avoids the oracle problem; see test-plan §2 Risk #1/#2).

import { sizeFromIntake } from "@/lib/services/generation/sizing";
import type { SessionIntake } from "@/types";

/** Default intake used across the suite. Budget 30 → theory 3–4, exactly 5 MCQs. */
export const DEFAULT_INTAKE: SessionIntake = {
  knowledgeLevel: "intermediate",
  learningGoal: "learn the basics",
  timeBudgetMinutes: 30,
};

// A short source with clearly identifiable spans. Every entry in CITATIONS below is a
// verbatim substring of this text, so a "valid" session is genuinely grounded.
export const SMALL_SOURCE = [
  "Photosynthesis converts light energy into chemical energy stored in glucose.",
  "Chlorophyll in the chloroplasts absorbs light, primarily in the blue and red wavelengths.",
  "The light-dependent reactions produce ATP and NADPH.",
  "The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugars.",
  "Oxygen is released as a byproduct when water molecules are split.",
].join(" ");

/** Verbatim substrings of SMALL_SOURCE, cycled to ground each theory step. */
const CITATIONS = [
  "Photosynthesis converts light energy into chemical energy stored in glucose.",
  "Chlorophyll in the chloroplasts absorbs light",
  "The light-dependent reactions produce ATP and NADPH.",
  "The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugars.",
  "Oxygen is released as a byproduct",
];

export interface TheoryStepInput {
  position: number;
  heading: string;
  body: string;
  citation: string;
}

export interface McqInput {
  position: number;
  prompt: string;
  options: string[];
  correctIndex: number;
  feedback: string;
}

export interface SessionShape {
  title: string;
  theory: TheoryStepInput[];
  exercises: McqInput[];
}

/**
 * Build a schema-valid session object for `intake`'s sizing. Theory citations are drawn
 * from CITATIONS (verbatim substrings of SMALL_SOURCE), so the result is grounded when
 * generated against SMALL_SOURCE. `overrides` shallow-merges onto the result so a caller
 * can mutate exactly one field (e.g. an ungrounded citation, a bad MCQ count, or theory
 * citations matching a different source) to manufacture a single case while keeping
 * everything else valid.
 */
export function buildValidSession(
  intake: SessionIntake = DEFAULT_INTAKE,
  overrides?: Partial<SessionShape>,
): SessionShape {
  const sizing = sizeFromIntake(intake);

  const theory: TheoryStepInput[] = Array.from({ length: sizing.theoryMax }, (_, i) => ({
    position: i,
    heading: `Step ${i + 1}`,
    body: `Explanation for step ${i + 1}.`,
    citation: CITATIONS[i % CITATIONS.length],
  }));

  const exercises: McqInput[] = Array.from({ length: sizing.mcqCount }, (_, i) => ({
    position: i,
    prompt: `Question ${i + 1}?`,
    options: ["Option A", "Option B", "Option C", "Option D"],
    correctIndex: 0,
    feedback: `Feedback for question ${i + 1}.`,
  }));

  return { title: "A Grounded Study Session", theory, exercises, ...overrides };
}

/** Same as buildValidSession, serialized to the JSON string the model would return. */
export function buildValidSessionJson(
  intake: SessionIntake = DEFAULT_INTAKE,
  overrides?: Partial<SessionShape>,
): string {
  return JSON.stringify(buildValidSession(intake, overrides));
}

/**
 * Build a source longer than the generation service's 60k cap, where `citedSpan`
 * appears ONLY beyond the cap and the groundable filler span "Lorem ipsum dolor sit
 * amet." sits within the first 60k. Used by the truncation-edge grounding test:
 * citations are validated against the truncated slice, so `citedSpan` is unreachable.
 */
export const FILLER_SPAN = "Lorem ipsum dolor sit amet.";

export function buildLargeSource(citedSpan: string, prefixChars = 61_000): string {
  const filler = `${FILLER_SPAN} `.repeat(Math.ceil(prefixChars / (FILLER_SPAN.length + 1)));
  return `${filler.slice(0, prefixChars)} ${citedSpan}`;
}
