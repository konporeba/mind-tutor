---
date: 2026-06-10T00:00:00Z
researcher: porebkon
git_commit: b01abd604a17d20d8059762be223a713790cde4e
branch: master
repository: MindTutor
topic: "Cross-learner isolation / IDOR across the session API (test-plan Phase 2, Risk #3)"
tags: [research, codebase, rls, authorization, idor, session-api, testing]
status: complete
last_updated: 2026-06-10
last_updated_by: porebkon
---

# Research: Cross-learner isolation / IDOR across the session API (Phase 2, Risk #3)

**Date**: 2026-06-10
**Researcher**: porebkon
**Git Commit**: b01abd604a17d20d8059762be223a713790cde4e
**Branch**: master
**Repository**: MindTutor

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md` (Risk #3 — a learner reads or
mutates another learner's session, materials, exercises, or score through the API by guessing
IDs). Enumerate session-scoped endpoints and quote the ownership enforcement; determine whether
ownership is enforced app-layer, by RLS, or both; identify the auth/session shape needed to drive
a second authenticated identity; locate any reusable route-integration harness; and name the
cheapest *useful* test layer, flagging speculative risk or misleading hot-spot evidence.

## Summary

**The single load-bearing finding: per-learner ownership is enforced exclusively by Supabase
Row Level Security. No session-scoped endpoint re-checks ownership in application code.** Every
handler authenticates the *user* (`context.locals.user`, 401 if absent) and then issues queries
that carry **no `user_id` filter** — they rely entirely on the RLS predicate
`user_id = (select auth.uid())` (defined once per table in the F-01 baseline migration) to scope
rows to the caller. Cross-learner reads/mutations therefore fail as **0-rows → `.single()` error →
404**, never an explicit 403.

This sharpens (and partly corrects) the test-plan's response guidance:

- The guidance's "likely cheapest layer — integration test hitting endpoints with a second
  authenticated identity" is **correct in direction but the cost is higher than implied**. Because
  the protection lives in Postgres RLS and *not* in TypeScript, the Phase-1 testing style (mock the
  Supabase seam, drive the handler) would **bypass the only thing that enforces isolation and pass
  while testing nothing**. A useful test for Risk #3 *must run against a real Postgres with the
  migrations + RLS applied* — i.e. a local Supabase instance. That harness does **not exist today**
  (Phase 1 only stubbed a single function seam; there is no DB-backed test path).
- The expected denial response is **404, not 403** — the response intent ("403/404") holds, but the
  plan/tests should assert 404 and the empty body, not assume 403.
- "Logged-in implies authorized" is exactly the assumption the code makes *in JS* — it is safe only
  for as long as the RLS policy is present and correct. That makes the highest-signal regression a
  **dropped/loosened RLS policy** (or a future endpoint that uses a service-role key and thus
  bypasses RLS). The cheapest test that catches that is **RLS-layer**, not handler-layer.

## Detailed Findings

### Session-scoped endpoints (every one under `src/pages/api/`)

| Endpoint | Verb | Op | Ownership enforcement in code | Cross-owner result |
|----------|------|----|-------------------------------|--------------------|
| `sessions/index.ts` | POST | create session (+material/theory/exercises) | Inserts with `user_id: user.id`; RLS `with check` validates | n/a (create) — but RLS `insert` check blocks forging another `user_id` |
| `sessions/[id]/complete.ts` | POST | read session, compute score, mark completed | **RLS only** — `select id ... .eq("id", sessionId).single()` then `update ... .eq("id", sessionId)`; no `user_id` filter | 404 (select returns 0 rows → `.single()` errors) |
| `sessions/[id]/exercises/[exerciseId].ts` | POST | read+update one MCQ answer | **RLS only** — `.eq("id", exerciseId).eq("session_id", sessionId).single()` then matching update; no `user_id` filter | 404 (select returns 0 rows) |
| `onboarding/index.ts` | POST | upsert caller's `profiles` row | Upserts `user_id: user.id`; RLS `with check` validates | n/a (self-scoped upsert) |

Auth-only routes (`auth/{signin,signup,signout,change-password}.ts`) are not session-scoped and
are out of Phase-2 scope.

### Quoted enforcement points

`src/pages/api/sessions/[id]/complete.ts:35-40` — the comment names RLS as the gate; the query has
no `user_id` term:

```ts
// Confirm the session exists and is owned by the learner (RLS-scoped).
const { error: sessionError } = await supabase.from("sessions").select("id").eq("id", sessionId).single();
if (sessionError) {
  return json({ error: "Session not found" }, 404);
}
```

`src/pages/api/sessions/[id]/complete.ts:53-56` — the UPDATE also relies on RLS (`.eq("id",...)`
only). A non-owner never reaches it because the select above 404s first; but note that an RLS-blocked
UPDATE returns **no error and 0 rows** — so the select gate is the real protection, and a test must
prove that gate fires.

`src/pages/api/sessions/[id]/exercises/[exerciseId].ts:44-49` — same pattern, with a belt-and-braces
`session_id` match (defends against passing your own session id with a victim's exercise id), but
still no `user_id`:

```ts
const { data: exercise, error: loadError } = await supabase
  .from("exercises")
  .select("id, correct_answer, feedback")
  .eq("id", exerciseId)
  .eq("session_id", sessionId)
  .single();
if (loadError) { return json({ error: "Exercise not found" }, 404); }
```

### The RLS policies are the contract under test

`supabase/migrations/20260528202720_domain_schema_rls_baseline.sql` defines the canonical
four-policy block per table. Example (`sessions`, lines 38-50); `materials` (71-83),
`generated_content` (103-115), `exercises` (141-153), and `profiles`
(`20260609100000_profiles_bio.sql:26-38`) repeat it verbatim:

```sql
create policy "sessions_select_own" on public.sessions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "sessions_insert_own" on public.sessions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "sessions_update_own" on public.sessions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "sessions_delete_own" on public.sessions
  for delete to authenticated using (user_id = (select auth.uid()));
```

Every table has `enable row level security` and a `user_id uuid not null references auth.users(id)`.
This is the exact surface a Risk-#3 regression would damage (a dropped/loosened policy, a missing
`enable row level security` on a future table, or a service-role client that bypasses RLS).

### How identity is resolved (what a second-identity test must reproduce)

- `src/middleware.ts:6-16` — `createClient(headers, cookies)` then `supabase.auth.getUser()` sets
  `context.locals.user`. Identity is entirely **cookie-borne**: the SSR client reads the auth cookies
  off the request `Cookie` header.
- `src/lib/supabase.ts:11-25` — `createServerClient(SUPABASE_URL, SUPABASE_KEY, { cookies })`. **The
  key is the anon/publishable key** (the `astro:env/server` `SUPABASE_KEY`), so `auth.uid()` is
  driven by the JWT in the session cookie. There is **no service-role client anywhere in `src/`**
  (`grep` for `service_role`/admin returns only the single `createClient` definition).
- Consequence for tests: a "second identity" means a **second authenticated Supabase session**
  (a real JWT for user B), not a stubbed `locals.user`. Stubbing `locals.user` and mocking the client
  would test the handler's 401 branch, not isolation.

### Test infrastructure today (and the gap)

- `vitest.config.ts` — `environment: "node"`, `include: ["src/**/*.test.ts"]`, `@/*` alias, and the
  `astro:env/server` alias pointing at `src/test/stubs/astro-env-server.ts` (dummy
  `OPENROUTER_API_KEY`/`MODEL`). This stub **only resolves the import graph**; it provides no DB and
  no Supabase env.
- Existing tests are all pure/seam-mocked generation tests
  (`src/lib/services/generation/*.test.ts`); helpers in `src/test/generation/` mock the OpenRouter
  function seam. **None of this is reusable for a DB-backed RLS test** — there is no route-integration
  harness, no Supabase test client, no fixture user seeding. Phase 2 bootstraps this from zero
  (matches §4 "API / route integration: none yet").
- **Local Supabase is configured and runnable**: `supabase/config.toml` exists with `api` on
  `:54321`, `db` on `:54322`; `supabase` CLI is a devDependency (`^2.23.4`); `supabase/seed.sql`
  exists. So a real-Postgres integration harness is feasible locally and is the cheapest path that
  actually exercises RLS. (CI wiring of a Supabase service is a later concern — §5 marks the gate
  "required after §3 Phase 2"; this research does not write CI YAML.)

## Code References

- `src/pages/api/sessions/index.ts:44-48,106-117,133-160` — auth check; inserts stamped with `user_id: user.id` (RLS `with check` is the real guard against forging ownership).
- `src/pages/api/sessions/[id]/complete.ts:19-40,53-56` — RLS-only read gate (404 on non-owner) + RLS-only update.
- `src/pages/api/sessions/[id]/exercises/[exerciseId].ts:21-49,57-65` — RLS-only read+update; extra `session_id` match.
- `src/pages/api/onboarding/index.ts:30-59` — self-scoped profile upsert (`user_id: user.id`).
- `src/middleware.ts:6-16` — cookie-based identity resolution via `auth.getUser()`.
- `src/lib/supabase.ts:7-25` — anon-key SSR client; cookies carry the JWT; no service-role client.
- `supabase/migrations/20260528202720_domain_schema_rls_baseline.sql:36-153` — RLS policies for sessions/materials/generated_content/exercises (the contract under test).
- `supabase/migrations/20260609100000_profiles_bio.sql:24-38` — profiles RLS (PK is `user_id`).
- `vitest.config.ts:7-20`, `src/test/stubs/astro-env-server.ts` — current harness (node env, import-graph stub only; no DB).
- `supabase/config.toml` (api :54321, db :54322), `supabase/seed.sql`, `package.json` (`supabase ^2.23.4`) — local Supabase is available.

## Architecture Insights

- **Authorization is a database concern here, not an application concern.** The handlers are
  deliberately thin: authenticate the user, then let RLS scope every row. This is a clean pattern,
  but it relocates the entire Risk-#3 attack surface into the SQL migrations. The test must target
  that surface to have signal.
- **Denial is uniform 404 via the `.single()`-on-empty pattern.** No endpoint distinguishes
  "doesn't exist" from "exists but not yours" — which is the correct non-enumerable behavior. Tests
  assert 404 + no leaked row data.
- **The dangerous future regression is bypassing RLS**, e.g. introducing a service-role client for
  some admin/batch path, or adding a table without `enable row level security`. A test that pins the
  RLS behavior at the DB layer is the cheapest early-warning for that class.

## Verification of the test-plan's Risk Response Guidance

| Guidance cell (test-plan §2, Risk #3) | Verdict after grounding |
|----------------------------------------|--------------------------|
| Prove non-owner gets 403/404 on every session-scoped read **and** mutation | **Confirmed**, refine to **404** specifically; endpoints: `complete` (read+mutate), `exercises/[exerciseId]` (read+mutate). `sessions` POST is create-only — cover the RLS `insert with check` (cannot forge another `user_id`). |
| Challenge "logged-in implies authorized" | **Confirmed and central** — the JS makes exactly this assumption; RLS is the only backstop. |
| Context to ground: ownership/RLS enforcement + second-identity auth shape | **Done** — RLS-only; cookie-borne JWT; anon key; no service-role. |
| Likely cheapest layer: integration with a second authenticated identity | **Direction confirmed, cost corrected** — must be **DB-backed (real Postgres + RLS)**, two real auth sessions; a mocked-client test is worse than useless. Cheapest *useful* option = RLS-layer integration against local Supabase. |
| Anti-pattern: testing only that the owner CAN read | **Confirmed**; add a second anti-pattern: **mocking the Supabase client** (bypasses RLS, green while broken). |

## Open Questions

1. **Test layer choice (for `/10x-plan`):** (a) RLS-layer — two `supabase-js` clients signed in as
   user A/B, assert cross reads/writes return 0 rows; cheapest, pins the contract, but doesn't
   exercise the handler's 404 translation. (b) Handler-layer — invoke the `APIRoute` POST functions
   with a real cookie session per user against local Supabase; proves the full request→404 path but
   needs more harness (faking `context`, cookies, params). Recommendation to weigh in planning:
   **(a) as the load-bearing isolation guarantee + a thin (b) slice on `complete` and
   `exercises/[exerciseId]` to pin the 404 translation.** Avoid full e2e (cost × signal).
2. **CI for a DB-backed suite** — local Supabase in CI is heavier than the current lint+build job.
   §5 already defers this gate to "required after §3 Phase 2"; planning should decide whether the new
   tests run only locally first, or gate a CI job. (No YAML in this rollout per lesson boundaries.)
3. **Seeding two users** — whether to seed via `supabase/seed.sql`, the auth admin API in a test
   bootstrap, or `signInWithPassword` against seeded users. A planning decision, not a blocker.

## Backport candidates for test-plan §2 (for `/10x-test-plan` to decide)

- **Response-guidance correction:** denial is **404** (not 403); add **"do not mock the Supabase
  client"** as an explicit anti-pattern, since the protection is entirely RLS.
- **Cheapest-layer refinement:** "integration with a second identity" → "**DB-backed** integration
  against real Postgres+RLS (local Supabase); RLS-layer is the cheapest useful layer."
- Hot-spot citation `src/pages/api/` is **accurate as likelihood evidence** but is *not* where the
  protection lives — the contract under test is `supabase/migrations/*` (RLS). Not misleading, but
  worth noting the protection's true location for the plan.
