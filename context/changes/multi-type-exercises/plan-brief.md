# Multi-type Exercises (S-04) — Plan Brief

> Full plan: `context/changes/multi-type-exercises/plan.md`

## What & Why

Extend the session loop from MCQ-only to three grounded exercise types — multiple
choice, fill-in-the-blank, and matching pairs — generated together, graded
server-side, and rendered in the session runner. This completes FR-009 (full),
replacing the MCQ-only partial from the S-01 north star.

## Starting Point

The S-01/S-02 pipeline generates and grades MCQs only. `exercises` is hard-typed
as `McqSchema[]`; grading is one inline string-equality check in the answer
endpoint; the UI renders MCQ buttons. Crucially, `computeScore` already counts
`is_correct` type-blind, and `exercises.kind`/`options`/`correct_answer` are
flexible (`text`/`jsonb`) — so the foundation absorbs new types without a column
migration.

## Desired End State

A learner gets a budget-sized mix of all three types in one session, each with
its own UI and server-side grading, every item resolving to a single
correct/incorrect that feeds the existing percent score. History replay and the
milestone bar work unchanged.

## Key Decisions Made

| Decision                  | Choice                                              | Why (1 sentence)                                                            | Source |
| ------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- | ------ |
| Third type                | Matching pairs                                      | Deterministic scoring, cross-domain, lowest grounding risk.                 | Roadmap |
| Type mix                  | Fixed counts per time budget                        | Deterministic, pure, unit-testable; preserves monotonic-by-budget sizing.   | Plan   |
| Matching scoring          | All-or-nothing (one is_correct per item)            | Keeps `computeScore` untouched; aggregation across types stays trivial.     | Plan   |
| Fill-blank grading        | Normalized equality + accepted-variants list        | Robust to casing/spacing/synonyms, no LLM in the score path.                | Plan   |
| Matching UI               | Dropdown (`<select>`) per left item                 | Accessible (getByRole/getByLabel), simplest state, mobile-friendly.         | Plan   |
| Pairs per matching item   | 4–6 pairs (right column shuffled once at write)     | Rigorous recall while fitting a single-sitting item.                        | Plan   |
| DB hardening              | Add `exercises.kind` CHECK migration                | Data hygiene mirroring `generated_content`; existing rows all `'mcq'`.      | Plan   |
| Invalid model output      | Validate exact per-type counts; retry once, then fail | Guarantees the multi-type contract; reuses S-01's retry pattern.          | Plan   |
| Test scope                | Sizing distribution + per-type grading (unit only)  | Locks the deterministic core; E2E stays with /10x-e2e.                      | Plan   |

## Scope

**In scope:** discriminated generation schema + per-type counts; prompt for the
mix; per-type persistence (matching shuffle at write); pure `gradeAnswer` module
+ endpoint refactor; `exercises.kind` CHECK migration; fill-blank + matching UI
renderers; sizing + grading unit tests.

**Out of scope:** partial credit; LLM-graded answers; types beyond these three;
per-subject-adaptive types; image items; column migrations; drag-and-drop/
click-to-pair UI; generation-mix-assertion test and E2E (the latter via /10x-e2e).

## Architecture / Approach

Heterogeneous exercises = a `kind`-discriminated union in the generation schema.
Persistence flattens each variant into the existing `exercises` columns
(`options` holds only displayable data; `correct_answer` holds the gated truth).
Grading and rendering branch on `kind`. The score path is unchanged because every
item — including matching (all-or-nothing) — yields exactly one `is_correct`.

## Phases at a Glance

| Phase                                  | What it delivers                                              | Key risk                                                    |
| -------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| 1. Generation contract & sizing        | Union schema + per-type counts + prompt; sizing tests        | Count-validation vs prompt drift across retries           |
| 2. Persistence, grading & hardening     | Per-type rows + matching shuffle; pure grading; CHECK migration | Leaking matching solution; matching shuffle desync         |
| 3. Session UI renderers                 | Fill-blank + matching renderers; widened loader/view         | Accessibility + answered-state restore for new types      |

**Prerequisites:** S-01 (done). Local Supabase + OpenRouter env for manual checks.
**Estimated effort:** ~2–3 sessions across the 3 phases.

## Open Risks & Assumptions

- Matching all-or-nothing means a single wrong pair fails the item — accepted as
  the cost of keeping `computeScore` unchanged.
- Fill-blank normalized matching can still miss valid phrasings the model didn't
  list as `acceptable` — accepted; no LLM grader by design.
- Assumes the model reliably produces 4–6 clean pairs / valid blanks from
  arbitrary sources; the retry-once-then-fail path is the backstop.

## Success Criteria (Summary)

- A session presents MCQ + fill-blank + matching, each answerable with correct
  per-item feedback.
- The final percent score correctly aggregates across all three types.
- Sizing + per-type grading unit tests pass; `lint` and `build` are green.
