// Shared domain entity types, derived from the generated Supabase schema.
// Import domain row types from here rather than reaching into the generated
// `database.types` file directly. Regenerate database.types.ts after any
// migration (see docs/reference/rls-policy-template.md).

import type { Database } from "@/db/database.types";

type Tables = Database["public"]["Tables"];

export type Session = Tables["sessions"]["Row"];
export type SessionInsert = Tables["sessions"]["Insert"];
export type SessionUpdate = Tables["sessions"]["Update"];

export type Material = Tables["materials"]["Row"];
export type MaterialInsert = Tables["materials"]["Insert"];
export type MaterialUpdate = Tables["materials"]["Update"];

export type GeneratedContent = Tables["generated_content"]["Row"];
export type GeneratedContentInsert = Tables["generated_content"]["Insert"];
export type GeneratedContentUpdate = Tables["generated_content"]["Update"];

export type Exercise = Tables["exercises"]["Row"];
export type ExerciseInsert = Tables["exercises"]["Insert"];
export type ExerciseUpdate = Tables["exercises"]["Update"];

export type Profile = Tables["profiles"]["Row"];
export type ProfileInsert = Tables["profiles"]["Insert"];
export type ProfileUpdate = Tables["profiles"]["Update"];

// --- Onboarding bio (S-03) -------------------------------------------------
// The free-text learner background captured once at onboarding (FR-005) and
// reused on every later session to set long-term idiom/depth (the bio half of
// FR-006). Stored on `profiles.bio`. Capped so the distilled (or raw-fallback)
// bio stays a bounded prompt ingredient.

export const BIO_MAX = 1000;

/** Free-text learner background, trimmed, <= BIO_MAX chars. Null = not captured. */
export type LearnerBio = string;

// --- Per-session intake (S-02) ---------------------------------------------
// The three FR-018 values captured at session start. Canonical shape shared by
// the generation service, the API layer, and the new-session form. Persisted as
// typed columns on `sessions` (see the session_intake_params migration).

export const KNOWLEDGE_LEVELS = ["novice", "beginner", "intermediate", "advanced", "expert"] as const;
export type KnowledgeLevel = (typeof KNOWLEDGE_LEVELS)[number];

export const TIME_BUDGETS = [15, 30, 60] as const;
export type TimeBudget = (typeof TIME_BUDGETS)[number];

export const LEARNING_GOAL_MAX = 280;

export interface SessionIntake {
  knowledgeLevel: KnowledgeLevel;
  /** Free text, trimmed, <= LEARNING_GOAL_MAX chars. */
  learningGoal: string;
  timeBudgetMinutes: TimeBudget;
}
