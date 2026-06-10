# Cross-learner Isolation Across the Session API (Risk #3) — Plan Brief

> Full plan: `context/changes/testing-cross-learner-isolation/plan.md`
> Research: `context/changes/testing-cross-learner-isolation/research.md`

## What & Why

Rollout Phase 2 of the test plan. Prove that a learner cannot read or mutate
another learner's session, materials, content, exercises, or score by guessing
ids (Risk #3, IDOR). Ownership is enforced **only** by Supabase RLS — no handler
re-checks `user_id` — so the test must run against real Postgres with the
migrations applied; a mocked client would pass while testing nothing.

## Starting Point

Session-scoped handlers authenticate the user then query with no `user_id`
filter, relying on the per-table policy `user_id = (select auth.uid())`. A
non-owner read returns 0 rows → `.single()` errors → handler returns **404**.
There is no DB-backed test harness today (only seam-mocked generation tests);
local Supabase is configured and runnable.

## Desired End State

A separate `npm run test:integration` suite runs against local Supabase and
proves, at the RLS layer, that user B gets nothing reading and changes nothing
mutating any of user A's rows (and cannot forge A's ownership on insert); and at
the handler layer, that `complete` and `exercises/[exerciseId]` return 404 with
no leaked data when B targets A's ids. Default `npm test` is unchanged and needs
no Supabase. `test-plan.md` §6.3/§6.7 document the pattern.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Test layer | RLS two-identity (load-bearing) + thin handler slices | Protection lives in RLS; handler slices only pin the 404 translation | Research |
| Denial code | Assert **404** (+ no data), not 403 | `.single()`-on-empty produces 404 uniformly | Research |
| User seeding | Admin API in test bootstrap, idempotent | Deterministic, self-contained real JWTs; test-only service-role key | Plan |
| Handler identity | `vi.mock createClient` → **real** authed client | RLS stays live; avoids brittle cookie reconstruction | Plan |
| Run separation | Separate `test:integration` script + config | Default `npm test` (CI/no-Docker) must not need Supabase | Plan |
| Isolation/cleanup | Fixed users, per-run unique data | Fast, parallel-safe, no destructive teardown | Plan |
| CI | Local-only first, no YAML | §5 defers gate to "after Phase 2"; lesson boundary | Research |

## Scope

**In scope:** RLS-layer isolation across `sessions`/`materials`/`generated_content`/`exercises`/`profiles`; forged-insert rejection; handler 404 slices on `complete.ts` and `exercises/[exerciseId].ts`; the integration harness; §6.3/§6.7 cookbook.

**Out of scope:** e2e; CI YAML; service-role client in `src/`; auth-only routes; `onboarding` handler slice; any handler/migration/RLS change.

## Architecture / Approach

Two real `supabase-js` clients (A, B) from a global setup that seeds users via
the admin API. RLS-layer specs assert non-owner read/update/delete = 0 rows (plus
owner-can controls) and forged insert = error. Handler slices `vi.mock`
`createClient` to a real B-authed client and call the `APIRoute` with a fake
`context` carrying A's ids, asserting 404 + no leaked data + the
`session_id`-mismatch edge case.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness | `test:integration` config/script, env wiring, seed-A/B setup, row factory | Env/key wiring + keeping default suite Supabase-free |
| 2. RLS isolation | Per-table non-owner read/write denial + forged-insert rejection | Asserting affected-count (not error) for blocked update/delete |
| 3. Handler slices | 404 translation on the two read+mutate endpoints | Documenting why real-client mock ≠ the anti-pattern |
| 4. Cookbook | §6.3 pattern + §6.7 note + §4 row | Keeping it actionable for the next contributor |

**Prerequisites:** local Supabase (`npx supabase start`, Docker); service-role + anon keys from `supabase status` in test env.
**Estimated effort:** ~1–2 sessions across 4 phases.

## Open Risks & Assumptions

- Requires a running local Supabase to execute (by design; CI deferred).
- Handler slices depend on `vi.mock` returning a *real* RLS-live client — must be clearly documented to avoid future "this mocks the DB" misreadings.
- `enable_confirmations = false` assumed (config.toml) so seeded users sign in without an email step.

## Success Criteria (Summary)

- Non-owner is **denied** (404 / 0 rows) on every session-scoped read and mutation; owner-can controls prove the denials are real.
- Forged-ownership insert is rejected.
- Default `npm test` stays green with no Supabase dependency.
