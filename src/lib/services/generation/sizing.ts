// Intake -> session shape (S-02).
//
// The single source of truth that translates the per-session intake into the
// structural target for a generated session: how many theory steps and MCQs to
// produce, and a short natural-language depth/pacing directive injected into the
// prompt. Imported by the generation service (to build the prompt + a dynamic
// validation schema) AND by the unit test (to assert intake measurably changes
// the output) — keep it pure so both agree on one definition.

import type { KnowledgeLevel, SessionIntake, TimeBudget } from "@/types";

export interface SessionSizing {
  /** Inclusive lower bound on theory steps. */
  theoryMin: number;
  /** Inclusive upper bound on theory steps. */
  theoryMax: number;
  /** Exact number of MCQs. */
  mcqCount: number;
  /** Short directive describing depth/pacing for the learner's level. */
  depthGuidance: string;
}

// Time budget drives volume. Monotonic by design: more time => >= counts, so a
// 60-min session is never smaller than a 15-min one (asserted in sizing.test.ts).
const COUNTS_BY_BUDGET: Record<TimeBudget, Pick<SessionSizing, "theoryMin" | "theoryMax" | "mcqCount">> = {
  15: { theoryMin: 2, theoryMax: 3, mcqCount: 3 },
  30: { theoryMin: 3, theoryMax: 4, mcqCount: 5 },
  60: { theoryMin: 4, theoryMax: 6, mcqCount: 8 },
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
    ...counts,
    depthGuidance: DEPTH_BY_LEVEL[intake.knowledgeLevel],
  };
}
