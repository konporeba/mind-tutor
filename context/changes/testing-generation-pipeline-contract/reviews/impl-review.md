<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Generation Pipeline Contract & Failure Modes

- **Plan**: context/changes/testing-generation-pipeline-contract/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-06-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Evidence: diff scope (`50008d8^..HEAD`) matches the plan exactly — 3 source files
(`generate.session.test.ts`, `openrouter-mock.ts`, `completion-builder.ts`) + the
`test-plan.md` cookbook edit, no unplanned source files. `npm test` → 24/24 passing.
`npm run lint` → 0 errors (3 pre-existing `no-console` warnings in files outside this
change). All Progress rows `[x]`; `change.md` status `implemented`.

## Findings

### F1 — buildValidSession signature diverges from the plan contract

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/test/generation/completion-builder.ts:62
- **Detail**: Plan Phase-1 contract specified `buildValidSession(source, intake, overrides?)`. Implementation dropped the unused `source` param (citations come from the SMALL_SOURCE-derived CITATIONS pool) to clear a `no-unused-vars` lint error. Behavior-equivalent for the suite; documented in JSDoc. Feeding the result against a different source would spuriously fail grounding — mitigated by `overrides` in the one cross-source (truncation) case.
- **Fix**: None needed — deviation is a documented improvement.
- **Decision**: SKIPPED (accept as-is)

### F2 — Manual item 3.5 marked complete before it can be observed

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/testing-generation-pipeline-contract/plan.md (Progress 3.5)
- **Detail**: "Re-running /10x-test-plan recognizes Phase 1 as complete" is `[x]`, but that orchestrator step hasn't run yet. The objective precondition (every Progress row `[x]`) is true, so it's not a false claim — just unverifiable until the orchestrator is re-run.
- **Fix**: None — verifies naturally on the next `/10x-test-plan` run.
- **Decision**: SKIPPED (accept as-is)

### F3 — Truncation test doesn't assert which citation was flagged

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (test rigor)
- **Location**: src/lib/services/generation/generate.session.test.ts:198
- **Detail**: The beyond-truncation test asserted rejection with "citation not found in source" but not that the flagged span was the beyond-cap `citedSpan`. It passed for the right reason today (FILLER_SPAN is provably within the first 60k), but would still pass for the wrong reason if the filler setup changed.
- **Fix**: Added `expect(message).toContain("Photosynthesis converts light energy")` to pin the failure to the truncated span (the error embeds the first 60 chars of the offending citation).
- **Decision**: FIXED — suite still 24/24 green.
