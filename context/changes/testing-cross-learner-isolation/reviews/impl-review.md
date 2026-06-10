<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Cross-learner Isolation (Risk #3, IDOR)

- **Plan**: context/changes/testing-cross-learner-isolation/plan.md
- **Scope**: Full plan (Phases 1–4)
- **Date**: 2026-06-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria re-run live: `npm test` 24✓ · `npm run test:integration` 23✓ · `npm run lint` 0 errors · `npx astro check` 0 errors. Diff equals the plan exactly (16 files, no EXTRA/MISSING/DRIFT). All "What We're NOT Doing" exclusions respected (no e2e, no CI YAML, no service-role client in `src/`, no handler/migration/RLS edits, no onboarding slice).

## Findings

### F1 — count() collapses a null-data response to 0 (latent false-confidence path)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/integration/rls-isolation.integration.test.ts:33-37
- **Detail**: The shared `count()` helper did `return (data ?? []).length`, so a denial assertion (`=== 0`) would pass on a degenerate `{ data: null, error: null }` response. Safe today (PostgREST returns `data: []` for RLS-filtered queries with `.select()`), but a future `.single()` refactor or behavior change could open a vacuous-pass path — the exact failure class this suite prevents.
- **Fix**: Throw on null data with no error before returning length.
- **Decision**: FIXED — added `if (data == null) throw new Error("[integration] expected an array result, got null")`; suite still 23✓, lint clean.

### F2 — Cross-run orphan accumulation; db reset is the only cleanup

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/test/integration/setup.ts:18-20, factories.ts, rls-isolation.integration.test.ts:51
- **Detail**: Fixed users + fresh per-run rows means domain rows accumulate across runs on a long-lived local stack. Correctness unaffected; the plan accepted this and relies on `supabase db reset`.
- **Fix**: Optional afterAll deleting the run's created session ids (children cascade).
- **Decision**: SKIPPED — accepted by design (per plan).

### F3 — No clear message if the stack is up but the schema is unmigrated

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/test/integration/env.ts, setup.ts:62-69
- **Detail**: A reachable-yet-unmigrated DB surfaces as a raw insert error deep in createSessionGraph rather than a "run migrations / db reset" hint.
- **Fix**: Optional migration-prerequisite note in the harness smoke test's failure path.
- **Decision**: SKIPPED — minor.

### F4 — test-plan.md §3 Phase 2 status / header not yet flipped to complete

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:85 (and header line 9)
- **Detail**: §3 Phase 2 row still reads `change opened`; header still "(Phase 1 complete)". BY DESIGN — the plan's Phase 4 note assigns the §3 status flip to the `/10x-test-plan` orchestrator on its next run, not to this implementation.
- **Fix**: None here — re-running `/10x-test-plan` advances §3 Phase 2 → complete.
- **Decision**: SKIPPED — expected orchestrator step, not drift.
