<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Onboarding Bio Tailoring (S-03)

- **Plan**: context/changes/onboarding-bio-tailoring/plan.md
- **Scope**: Full plan (Phases 1–5)
- **Date**: 2026-06-09
- **Verdict**: APPROVED (one warning to decide on before archive)
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — First-time learner isn't redirected to onboarding on sign-in

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/middleware.ts:18-37 · src/pages/api/auth/signin.ts:19
- **Detail**: Plan's Desired End State says a first-time learner is "redirected to /onboarding" on sign-in. But signin.ts redirects to `/` (public Welcome page), and the gate scopes to PROTECTED_ROUTES, so a fresh learner is only forced to /onboarding once they navigate to /dashboard, /account, or /sessions/*. The plan left `/` gating optional and Phase 4 criterion 4.3 (force from gated surfaces) IS satisfied — so this is an end-state/UX gap, not a broken contract.
- **Fix A ⭐ Recommended**: Redirect sign-in to /dashboard instead of `/`.
  - Strength: /dashboard is already gated → non-onboarded bounces to /onboarding, onboarded lands on dashboard; one-line change, no new middleware branches.
  - Tradeoff: Changes pre-existing S-01 sign-in landing behavior.
  - Confidence: HIGH — gate verified working on /dashboard (4.3).
  - Blind spot: Whether authenticated users should ever see `/`.
- **Fix B**: Add `/` to the gated set with an exempt-list in middleware.
  - Strength: Catches authenticated-not-onboarded users even on `/`.
  - Tradeoff: Gates public landing for signed-in users; needs the exempt list; more surface area.
  - Confidence: MED — more branches/loop-safety to maintain.
  - Blind spot: Interaction with future public authenticated content.
- **Decision**: FIXED via Fix A — signin.ts redirect changed `/` → `/dashboard` (commit pending)

### F2 — Middleware gate omits the plan's explicit exempt-list

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/middleware.ts:18-37
- **Detail**: Plan described gating with an explicit exempt-list (/onboarding, /api/onboarding, /auth/*, /api/auth/*). Implementation gates ONLY PROTECTED_ROUTES and relies on exempt paths not matching a protected prefix — equivalent and loop-safe, arguably cleaner. Mechanism differs from contract; behavior matches intent. No action needed.
- **Decision**: SKIPPED — simpler mechanism accepted as equivalent and loop-safe

### F3 — Per-route `json()` helper duplicated

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/onboarding/index.ts:31-36
- **Detail**: onboarding/index.ts defines its own `json()` helper, identical to sessions/index.ts. This MATCHES the existing project convention (each API route carries its own helper), so it's consistent, not drift — noted only as a future extraction candidate if the count grows.
- **Decision**: SKIPPED — matches existing per-route convention, not new drift
