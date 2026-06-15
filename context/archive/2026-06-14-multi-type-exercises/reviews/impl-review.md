<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Multi-type Exercises (S-04)

- **Plan**: context/changes/multi-type-exercises/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-06-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (2 observations) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (1 manual item pending) |

Automated evidence: `npx vitest run` 68/68; `npm run lint` 0 errors; `npx astro check` 0 errors; `npm run test:integration` 23/23; live multi-type drive 14/14; migration applied to local DB.

## Findings

### F1 — Answer endpoint has no re-answer / session-status guard

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/sessions/[id]/exercises/[exerciseId].ts:74-96
- **Detail**: POST updates learner_answer/is_correct unconditionally — no check that the exercise is unanswered or the session active. A learner could replay the API after finishing to flip is_correct then re-POST /complete to change their score. PRE-EXISTING (original MCQ endpoint behaved identically); UI prevents it. Not an S-04 regression, but S-04 touched this file.
- **Fix**: Add an early guard — reject (409) when answered_at is not null or session status is 'completed'. Out of S-04 scope; good follow-up or /10x-lesson.
- **Decision**: FIXED — added a 409 guard in [exerciseId].ts (answered_at set OR session completed); verified live (re-answer → 409 for all three types) and integration suite still green.

### F2 — Semantic grounding judge skips fill_blank / matching prose

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/services/grounding/judge.ts:67-75
- **Detail**: buildGroundingClaims continues on non-mcq kinds, grading only MCQ prose. Documented & deliberate (judge is an out-of-prod TEST asset; grounding expansion was out of S-04 scope). In PROD nothing changes — the judge never runs there; only theory citations are structurally grounded, same as before S-04. No prod-wedge regression, only deferred test coverage.
- **Fix**: None now. Extending the judge's field taxonomy to fill/matching is its own task — track as backlog if the wedge needs it.
- **Decision**: SKIPPED — accepted as a deliberate, documented scope call (judge is out-of-prod; no prod-grounding regression).

### F3 — Matching grading ignores extra/unknown submitted keys

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/grading.ts:54-66 (matching branch)
- **Detail**: gradeAnswer verifies every correct pair's left maps to its right but doesn't reject a submission carrying additional unknown left keys. Benign — UI only emits known lefts; extra keys don't change correctness — but a stricter check would reject malformed payloads. Correctness unaffected.
- **Fix**: Optional — require submitted key count to equal pairs.length. Not worth churn unless strict input validation is wanted.
- **Decision**: FIXED — added `Object.keys(submitted).length !== pairs.length → false` in grading.ts matching branch, plus a unit test (grading.test.ts now 18 tests).

### F4 — Manual criterion 3.5 (reload-restore) not directly verified

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/multi-type-exercises/plan.md (Progress 3.5)
- **Detail**: Honestly left unchecked (not rubber-stamped). Reload-restore for all three types is structurally covered by SessionRunner's seededResults (seeds from persisted is_correct/learner_answer/correct_answer), and the live drive proved persisted answered-state loads — but a reload-after-answer assertion wasn't driven.
- **Fix**: Cover with an E2E case in /10x-e2e (the natural home), or a quick manual reload click.
- **Decision**: FIXED — re-drove a live reload assertion: after answering, a fresh GET of the session page restores the answered state (feedback + "Correct") for all three types (9/9 checks). Plan item 3.5 now checked.
