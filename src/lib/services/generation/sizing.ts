// Intake -> session shape (S-02, extended for multi-type in S-04).
//
// The single source of truth that translates the per-session intake into the
// structural target for a generated session: how many theory steps and how many
// exercises OF EACH TYPE to produce, and a short natural-language depth/pacing
// directive injected into the prompt. Imported by the generation service (to
// build the prompt + a dynamic validation schema) AND by the unit test (to
// assert intake measurably changes the output) — keep it pure so both agree on
// one definition.

import type { ExerciseKind, KnowledgeLevel, SessionIntake, TimeBudget } from "@/types";

/** Exact number of exercises to generate for each type. */
export type ExerciseCounts = Record<ExerciseKind, number>;

export interface SessionSizing {
  /** Inclusive lower bound on theory steps. */
  theoryMin: number;
  /** Inclusive upper bound on theory steps. */
  theoryMax: number;
  /** Exact exercise count per type (mcq / fill_blank / matching). */
  exerciseCounts: ExerciseCounts;
  /** Short directive describing depth/pacing for the learner's level. */
  depthGuidance: string;
}

// Time budget drives volume. The fixed per-budget mix (S-04): every budget yields
// all three types, and every per-type count AND the total are monotonic
// non-decreasing by budget (asserted in sizing.test.ts), so a 60-min session is
// never smaller than a 15-min one for any type.
const COUNTS_BY_BUDGET: Record<TimeBudget, { theoryMin: number; theoryMax: number; exerciseCounts: ExerciseCounts }> = {
  15: { theoryMin: 2, theoryMax: 3, exerciseCounts: { mcq: 2, fill_blank: 1, matching: 1 } },
  30: { theoryMin: 3, theoryMax: 4, exerciseCounts: { mcq: 3, fill_blank: 1, matching: 1 } },
  60: { theoryMin: 4, theoryMax: 6, exerciseCounts: { mcq: 4, fill_blank: 2, matching: 2 } },
};

// Knowledge level shapes depth/pacing rather than volume.
const DEPTH_BY_LEVEL: Record<KnowledgeLevel, string> = {
  novice:
    "The learner is new to this material. Explain foundational concepts plainly, define terminology on first use, assume no prior knowledge, and keep each step short.",
  beginner: "The learner has minimal exposure. Build up from fundamentals with concrete examples and a gentle pace.",
  intermediate:
    "The learner knows the basics. Move briskly past fundamentals and focus on applying and connecting concepts.",
  advanced: "The learner is experienced. Skip the basics and emphasize nuance, edge cases, and deeper implications.",
  expert:
    "The learner is highly proficient. Be concise and high-level; focus on subtle distinctions, trade-offs, and advanced synthesis.",
};

/** Deterministically translate intake into the target shape for generation. Pure. */
export function sizeFromIntake(intake: SessionIntake): SessionSizing {
  const counts = COUNTS_BY_BUDGET[intake.timeBudgetMinutes];
  return {
    theoryMin: counts.theoryMin,
    theoryMax: counts.theoryMax,
    exerciseCounts: { ...counts.exerciseCounts },
    depthGuidance: DEPTH_BY_LEVEL[intake.knowledgeLevel],
  };
}
