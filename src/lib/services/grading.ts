// Per-type answer grading (S-04, FR-010/FR-011).
//
// The single source of truth for deciding whether a learner's answer to an
// exercise is correct, branching on exercise kind. Pure and I/O-free so it is
// unit-testable independent of HTTP/DB; the answer endpoint
// (api/sessions/[id]/exercises/[exerciseId].ts) loads the row and calls this.
//
// Every exercise — including matching — resolves to a single boolean, so the
// percent-correct score (scoring.ts) aggregates across types unchanged. Matching
// is ALL-OR-NOTHING: every pair must be matched correctly for the item to count.
// No LLM is involved; fill-in-the-blank uses normalized, case-insensitive
// equality against the canonical answer plus any accepted variants.

export interface GradeInput {
  /** The exercise kind: "mcq" | "fill_blank" | "matching". */
  kind: string;
  /** The persisted truth from exercises.correct_answer (shape varies by kind). */
  correct_answer: unknown;
  /** The learner's submitted answer (string for mcq/fill_blank, mapping for matching). */
  submitted: unknown;
}

/** Trim, collapse internal whitespace, and lowercase — the fill-blank match basis. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A plain object whose every value is a string (the matching submission shape). */
function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

/**
 * Decide whether `submitted` correctly answers an exercise of `kind`. A malformed
 * submission or correct_answer for the kind grades as incorrect (never throws).
 */
export function gradeAnswer({ kind, correct_answer, submitted }: GradeInput): boolean {
  switch (kind) {
    case "mcq":
      // correct_answer is the option text; strict equality with the picked option.
      return typeof submitted === "string" && typeof correct_answer === "string" && submitted === correct_answer;

    case "fill_blank": {
      // correct_answer = { answer: string, acceptable: string[] }.
      if (typeof submitted !== "string") return false;
      const truth = correct_answer as { answer?: unknown; acceptable?: unknown } | null;
      if (!truth || typeof truth.answer !== "string") return false;
      const variants: unknown[] = Array.isArray(truth.acceptable) ? (truth.acceptable as unknown[]) : [];
      const accepted = [truth.answer, ...variants].filter((a): a is string => typeof a === "string").map(normalize);
      return accepted.includes(normalize(submitted));
    }

    case "matching": {
      // correct_answer = { pairs: Array<{ left, right }> }; submitted = { [left]: right }.
      // All-or-nothing: every correct pair's left must map to its exact right.
      if (!isStringRecord(submitted)) return false;
      const truth = correct_answer as { pairs?: unknown } | null;
      const pairs = truth?.pairs;
      if (!Array.isArray(pairs) || pairs.length === 0) return false;
      // Reject malformed submissions that carry extra/unknown left keys.
      if (Object.keys(submitted).length !== pairs.length) return false;
      for (const pair of pairs) {
        if (!pair || typeof pair !== "object") return false;
        const { left, right } = pair as { left?: unknown; right?: unknown };
        if (typeof left !== "string" || typeof right !== "string") return false;
        if (submitted[left] !== right) return false;
      }
      return true;
    }

    default:
      return false;
  }
}
