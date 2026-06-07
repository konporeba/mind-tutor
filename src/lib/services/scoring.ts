// Performance scoring (S-01, FR-011).
//
// The session score is the percentage of exercises answered correctly, computed
// server-side from the persisted exercise rows (the single source of truth).

import type { Exercise } from "@/types";

/**
 * Percentage (0-100, rounded) of exercises marked correct.
 * An empty set scores 0. Unanswered rows (is_correct null) count as incorrect.
 */
export function computeScore(exercises: Pick<Exercise, "is_correct">[]): number {
  const total = exercises.length;
  if (total === 0) {
    return 0;
  }
  const correct = exercises.filter((e) => e.is_correct === true).length;
  return Math.round((correct / total) * 100);
}
