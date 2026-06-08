<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Domain Schema + Per-Learner RLS Baseline

- **Plan**: context/changes/domain-schema-rls-baseline/plan.md
- **Scope**: All 4 phases (complete)
- **Date**: 2026-06-07
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Headline roadmap risk (a wrong RLS pattern propagating to future tables) is provably handled: all 16 policies use `(select auth.uid())`, insert/update carry `with check`, `anon` is default-denied (no anon policy), and the pgTAP test asserts cross-account write _effect_ (not just no-error) across all four tables. All planned deliverables MATCH; the only deviations are additive and benign (per-child `session_id` indexes, `Insert`/`Update` aliases in `src/types.ts`, anticipated `supabase/seed.sql` and the `eslint.config.js` ignore for generated types).

## Findings

### F1 — exercises.kind has no CHECK constraint

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260528202720_domain_schema_rls_baseline.sql:124
- **Detail**: `sessions.status` (line 26) and `generated_content.kind` (line 92) both carry `check (... in (...))`. `exercises.kind` is `text not null default 'mcq'` with no constraint, so arbitrary strings are accepted. The plan deliberately left this open ("MCQ for S-01; S-04 extends"), so this is plan-sanctioned, not drift — but it is the one place the enumerated-column pattern is applied inconsistently.
- **Fix**: Either add `check (kind in ('mcq'))` now (widen in S-04), or leave as-is intentionally (plan already sanctions it).
- **Decision**: SKIPPED

### F2 — sessions.updated_at has no auto-update mechanism

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: supabase/migrations/20260528202720_domain_schema_rls_baseline.sql:30
- **Detail**: `updated_at` defaults to `now()` on insert but nothing maintains it on UPDATE. It will silently go stale unless S-01's app code sets it on every write. Not specified in the plan either way — flagged because it is a latent surprise the next slice inherits.
- **Fix**: Add a `moddatetime` trigger now, OR document "app owns updated_at" in the contract-surfaces / template doc so S-01 knows.
- **Decision**: FIXED — added `supabase/migrations/20260607131334_sessions_updated_at_trigger.sql` (moddatetime trigger on `sessions.updated_at`). Needs `npx supabase db reset` to apply locally.

### F3 — anon test covers SELECT only, not writes

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/rls_isolation_test.sql:95-100
- **Detail**: The anon block asserts 0 rows visible (SELECT) but never attempts an anon INSERT/UPDATE/DELETE. Default-deny with no anon policy makes this safe, so it is untested-but-correct, not a hole. Optional hardening.
- **Fix**: Add anon write-attempt assertions to the isolation test (assert effect = 0 rows).
- **Decision**: FIXED — added anon INSERT (throws 42501) + UPDATE/DELETE no-op effect assertions on `sessions` (representative); plan count 20 → 23. Needs `npx supabase test db` to verify locally.
