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

// --- Exercise kinds (S-04) --------------------------------------------------
// The three exercise types a session can contain. MCQ shipped in S-01;
// fill-in-the-blank and matching-pairs land in S-04 (FR-009 full). Shared by the
// generation schema, sizing, persistence, grading, and the kind CHECK constraint
// on `exercises.kind`.

export const EXERCISE_KINDS = ["mcq", "fill_blank", "matching"] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

export type Profile = Tables["profiles"]["Row"];
export type ProfileInsert = Tables["profiles"]["Insert"];
export type ProfileUpdate = Tables["profiles"]["Update"];

export type ConversationMessage = Tables["conversation_messages"]["Row"];
export type ConversationMessageInsert = Tables["conversation_messages"]["Insert"];
export type ConversationMessageUpdate = Tables["conversation_messages"]["Update"];

// --- Ask-the-tutor conversation turns (S-05) -------------------------------
// Persisted Q&A turns within a session (FR-008). Each turn is a learner question
// ('user') or a grounded tutor answer ('assistant'), ordered by `position` and
// stored append-only in `conversation_messages`. Persisting turns is what lets
// S-06 (session history) replay the conversation.

export const CONVERSATION_ROLES = ["user", "assistant"] as const;
export type ConversationRole = (typeof CONVERSATION_ROLES)[number];

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
