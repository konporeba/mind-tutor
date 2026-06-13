import { describe, expect, it } from "vitest";

import type { Exercise } from "@/types";
import { computeScore } from "./scoring";

// Risk #4 — the score must equal an INDEPENDENTLY-computed percentage correct,
// not a value lifted from computeScore (the oracle anti-pattern, test-plan §2).
// Every `expected` below is derived by hand from the fixture rows:
//   score = round(count(is_correct === true) / total * 100), empty set -> 0.
//
// computeScore reads only `is_correct`, so the rows are typed as a Pick that
// also carries `kind` — proving the function aggregates identically regardless
// of exercise kind (it never inspects `kind`).
type ScoreRow = Pick<Exercise, "is_correct" | "kind">;

function row(is_correct: boolean | null, kind = "mcq"): ScoreRow {
  return { is_correct, kind };
}

describe("computeScore", () => {
  it("scores an empty set as 0", () => {
    // 0 exercises -> the empty-set rule short-circuits to 0.
    expect(computeScore([])).toBe(0);
  });

  it("scores an all-correct set as 100", () => {
    // 3 of 3 correct -> 3/3 * 100 = 100.
    const exercises = [row(true), row(true), row(true)];
    expect(computeScore(exercises)).toBe(100);
  });

  it("rounds 1-of-3 down to 33", () => {
    // 1/3 * 100 = 33.33… -> Math.round -> 33.
    const exercises = [row(true), row(false), row(false)];
    expect(computeScore(exercises)).toBe(33);
  });

  it("rounds 2-of-3 up to 67", () => {
    // 2/3 * 100 = 66.67… -> Math.round -> 67.
    const exercises = [row(true), row(true), row(false)];
    expect(computeScore(exercises)).toBe(67);
  });

  it("rounds the .5 boundary toward +∞ (1-of-8 -> 13)", () => {
    // 1/8 * 100 = 12.5 -> Math.round rounds .5 toward +∞ -> 13.
    const exercises = [row(true), row(false), row(false), row(false), row(false), row(false), row(false), row(false)];
    expect(computeScore(exercises)).toBe(13);
  });

  it("counts unanswered (is_correct null) rows as incorrect", () => {
    // 2 true / 1 false / 2 null over 5 total -> 2/5 * 100 = 40.
    // null counts toward `total` but never toward `correct`.
    const exercises = [row(true), row(true), row(false), row(null), row(null)];
    expect(computeScore(exercises)).toBe(40);
  });

  it("aggregates across exercise kinds (kind-agnostic)", () => {
    // 2 correct of 3 total, spread across mcq + a future kind -> 2/3 -> 67.
    // The future-kind row contributes to the total and (when true) to correct,
    // exactly like an mcq row — computeScore never branches on `kind`.
    const exercises = [row(true, "mcq"), row(false, "mcq"), row(true, "flashcard")];
    expect(computeScore(exercises)).toBe(67);
  });
});
