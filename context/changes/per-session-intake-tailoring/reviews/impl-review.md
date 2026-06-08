<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Per-Session Intake Tailoring (S-02)

- **Plan**: context/changes/per-session-intake-tailoring/plan.md
- **Scope**: Full plan (Phases 1–5 of 5)
- **Date**: 2026-06-08
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

## Summary

Faithful, complete realization of the plan across all five phases. Two independent
sub-agents found zero drift and zero missing work. DB CHECK constraints, the API
zod schema, and the TS unions agree precisely (5 knowledge levels / goal ≤280 /
time ∈ {15,30,60}). The one EXTRA file (`src/test/stubs/astro-env-server.ts`) is a
justified, documented test shim required by the plan's own "test the real
`buildMessages`" goal — not scope creep.

Success criteria evidenced by CI run 27159293298 on HEAD `20763c3` (lint + test +
build all green); Phase 1 Supabase checks verified at `740a161`; all manual Progress
rows user-signed-off.

W1 (raised by the safety agent — does the failure-cleanup path rely on cascade FKs
that exist?) was **resolved during review**: `materials`, `generated_content`, and
`exercises` all declare `session_id ... references public.sessions (id) on delete
cascade` in the baseline migration `20260528202720_domain_schema_rls_baseline.sql`.
Not a finding.

## Findings

### F1 — Retained fixed-count schema is now an unreachable fallback

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture / Pattern Consistency
- **Location**: src/lib/services/generation/schema.ts:11-16,41-45
- **Detail**: `THEORY_MIN`/`THEORY_MAX`/`MCQ_COUNT` and `GeneratedSessionSchema` are documented as the fallback for "any call path without intake," but after Phase 3 `generateSession` always receives intake and always uses `makeGeneratedSessionSchema(sizing)`. The fixed-count path is now unreachable. This is per-plan-intent (the plan explicitly said to keep them as fallback defaults), so it is not drift — just a note that the "fallback" is currently dead surface. The per-item schemas (`TheoryStepSchema`/`McqSchema`) remain genuinely shared and are fine.
- **Fix**: Leave as-is (matches the plan), or drop the unused fixed-count schema + constants and keep only the shared per-item schemas.
- **Decision**: SKIPPED — per-plan-intent; recorded for awareness only.

### F2 — Unthrottled paid LLM call on every authenticated POST

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/sessions/index.ts:87-97
- **Detail**: Each authenticated POST fires an OpenRouter generation before any persistence. Auth gating (401) is present, but there is no per-user rate/abuse limit on an expensive external call — and S-02 widens the 60-min bucket's caps (more theory + 8 MCQs), modestly raising per-call cost. Pre-existing from S-01, not introduced here, and explicitly outside this slice's scope.
- **Fix**: Out of scope for S-02 — track as a follow-up (per-user throttle or quota on `/api/sessions`) rather than fixing here.
- **Decision**: SKIPPED — out of scope (pre-existing S-01 behavior).

### F3 — Model-supplied `position` is trusted, not re-sequenced

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/api/sessions/index.ts:142,148
- **Detail**: Persisted theory/MCQ `position` comes straight from the LLM; the schema only checks `int().nonnegative()`, not uniqueness or a contiguous 0..n-1 sequence. A model returning gapped/duplicate positions persists as-is. Pre-existing S-01 behavior, untouched by S-02; low impact since count + grounding are validated.
- **Fix**: Out of scope — if the UI assumes contiguous ordering, consider re-deriving `position` from array index on insert (follow-up).
- **Decision**: SKIPPED — out of scope (pre-existing S-01 behavior).
