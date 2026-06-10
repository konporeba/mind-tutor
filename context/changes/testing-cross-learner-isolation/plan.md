# Cross-learner Isolation Across the Session API (Risk #3, IDOR) Implementation Plan

## Overview

Rollout Phase 2 of `context/foundation/test-plan.md`. Build MindTutor's first
DB-backed integration test harness and use it to prove **cross-learner isolation**:
a learner must never read or mutate another learner's session, materials,
generated content, exercises, or score by guessing ids. The load-bearing guarantee
is asserted at the **RLS layer** (where the protection actually lives), with a thin
**handler-layer slice** on `complete.ts` and `exercises/[exerciseId].ts` to pin the
`.single()`-error → **404** translation. No e2e; no CI YAML this rollout.

## Current State Analysis

- **Ownership is enforced exclusively by Supabase RLS.** Every session-scoped
  handler authenticates the *user* (`context.locals.user`, 401 if absent) and then
  queries with **no `user_id` filter** — it relies on the per-table policy
  `user_id = (select auth.uid())` to scope rows. A non-owner read returns 0 rows →
  `.single()` errors → the handler returns **404** (never 403).
  - `src/pages/api/sessions/[id]/complete.ts:36` — `.select("id").eq("id", sessionId).single()`; `:38-40` returns 404 on error; `:53-56` RLS-only UPDATE.
  - `src/pages/api/sessions/[id]/exercises/[exerciseId].ts:44-49` — `.eq("id", exerciseId).eq("session_id", sessionId).single()`; `:51-52` returns 404; `:57-65` RLS-only UPDATE with the same belt-and-braces `session_id` match.
  - `src/pages/api/sessions/index.ts:106-160` — create path stamps `user_id: user.id`; RLS `insert with check` is the real guard against forging another user's `user_id`.
- **The contract under test is SQL, not TS.** `supabase/migrations/20260528202720_domain_schema_rls_baseline.sql:36-153` defines the canonical four-policy block for `sessions`/`materials`/`generated_content`/`exercises`; `supabase/migrations/20260609100000_profiles_bio.sql` repeats it for `profiles`. A mocked Supabase client would bypass this and pass while testing nothing.
- **Identity is cookie-borne JWT on the anon key.** `src/lib/supabase.ts:7-25` builds an SSR client with `SUPABASE_KEY` (anon/publishable); `src/middleware.ts:6-16` resolves the user from auth cookies. There is **no service-role client in `src/`**. A "second identity" therefore means a second *real* authenticated session, not a stubbed `locals.user`.
- **No DB-backed test path exists.** `vitest.config.ts` is `node` env, `include: ["src/**/*.test.ts"]`, with the `astro:env/server` alias pointing at a dummy-env stub. The only tests are seam-mocked generation tests (`src/lib/services/generation/*.test.ts`, helpers in `src/test/generation/`). None of it is reusable for RLS — it provides no DB, no Supabase client, no user seeding.
- **Local Supabase is available.** `supabase/config.toml` (api `:54321`, db `:54322`, `auth.email.enable_confirmations = false` so seeded users sign in immediately), `supabase` CLI `^2.23.4` devDependency, empty `supabase/seed.sql`. The cheapest *useful* layer is integration against this local stack.

## Desired End State

- A `test:integration` npm script runs a DB-backed Vitest suite against local Supabase. The default `npm test` is unchanged and still runs **without** Supabase (CI and Docker-less devs stay green).
- Running `test:integration` against a started local stack:
  - **RLS layer:** proves user B reading any of user A's rows returns 0 rows, B mutating any of A's rows affects 0 rows, and B cannot insert a row stamped with A's `user_id`. Owner-can controls prove the rows genuinely exist and are reachable by their owner.
  - **Handler layer:** proves `POST /api/sessions/[id]/complete` and `POST /api/sessions/[id]/exercises/[exerciseId]` return **404 with no leaked row data** when driven by user B against user A's ids, including the `session_id`-mismatch edge case; an owner-200 control proves the 404 isn't spurious.
- `test-plan.md` §6.3 and §6.7 document the pattern; the §4 "API / route integration" row reflects the new harness.

### Key Discoveries:

- Denial is uniform **404 via `.single()`-on-empty** (`complete.ts:38`, `exercises/[exerciseId].ts:51`) — assert 404 + empty/no-row body, never 403.
- An RLS-blocked **UPDATE returns no error and 0 rows** (`complete.ts:53-56`) — so the cross-mutation assertion is "**0 rows affected**", not "error thrown". The read gate is what produces the 404; the update gate is a second backstop.
- An RLS-blocked **INSERT with a forged `user_id` raises an error** (`with check` violation) — so the create-path assertion *is* "error present".
- `exercises/[exerciseId].ts:48` adds `.eq("session_id", sessionId)` — exercise this directly: B passing A's exerciseId with B's own sessionId must still 404.
- `enable_confirmations = false` (`config.toml:209`) means admin-created users can `signInWithPassword` immediately — no email-confirmation step in the bootstrap.

## What We're NOT Doing

- **No e2e** (no Playwright/Cypress) — cost × signal; RLS + handler-slice integration covers Risk #3.
- **No CI YAML / no CI wiring** — research OQ2 and §5 defer the gate to "required after §3 Phase 2"; this rollout makes the suite **local-only first**. (Lesson boundary: this lesson names gates, it does not author pipelines.)
- **No service-role client in `src/`** — the service-role key is used *only* inside the test bootstrap for user seeding; app code stays anon-key + RLS.
- **No auth-only routes** (`auth/{signin,signup,signout,change-password}.ts`) — not session-scoped, out of Phase-2 scope.
- **No changes to handlers, migrations, or RLS policies** — this phase adds tests only; if a test reveals a policy gap, that is a separate change.
- **No `onboarding/index.ts` handler slice** — it is a self-scoped upsert (no cross-owner read path); its `profiles` isolation is covered at the RLS layer.

## Implementation Approach

Two test layers, cheapest-useful first:

1. **RLS layer (load-bearing).** Two real `supabase-js` clients signed in as A and B drive queries directly against local Postgres with migrations + RLS applied. This pins the actual contract and is the cheapest early-warning for the dangerous regression class (a dropped/loosened policy, a missing `enable row level security`, or a future service-role bypass).
2. **Handler layer (translation slice).** For the two read+mutate endpoints, `vi.mock` `@/lib/supabase`'s `createClient` to return a **real** client authed as B (anon key + B's JWT) — RLS is still live, only client *construction* is stubbed — and invoke the `APIRoute` with a fake `context` carrying A's ids. This proves the full request → `.single()` error → 404 path, which the RLS-layer test cannot see.

Identities come from a global setup that idempotently creates users A/B via the admin API and exposes their signed-in clients. Each test creates its own owned rows per run (fixed users, unique data) so re-runs and mid-run failures never poison state.

## Critical Implementation Details

- **`vi.mock` is hoisted and per-file.** The handler-slice files must declare the `createClient` mock with the `vi.hoisted` pattern already established in `src/test/generation/openrouter-mock.ts`. The mock returns a real authed client, so RLS still enforces — document inline why this is **not** the forbidden "mock the Supabase client" anti-pattern (the returned client is real and RLS-live; only construction is intercepted).
- **The service-role key is test-only.** It is read from a test env var inside the bootstrap, never imported into `src/`. The bootstrap is the one place admin privileges exist; every assertion runs through anon-key + RLS clients.
- **Two separate Vitest configs.** The DB suite must not enter the default `include` glob, or `npm test` would fail without Supabase. Use a distinct file suffix (`*.integration.test.ts`) and a dedicated config so the default run is untouched.

## Phase 1: DB-backed integration harness

### Overview

Stand up the first real-Postgres test path: a dedicated config + script, env wiring for local Supabase keys, a global setup that seeds and signs in users A/B, and a factory for creating owned domain rows. Default `npm test` stays Supabase-free.

### Changes Required:

#### 1. Integration Vitest config

**File**: `vitest.integration.config.ts` (new)

**Intent**: A second Vitest config whose `include` matches only DB-backed specs, so the default suite never requires Supabase. Mirrors the `@/*` alias from `vitest.config.ts`; loads the global setup; does **not** alias `astro:env/server` to the dummy stub for tests that need real env (handler slices import `@/lib/supabase`, which reads `astro:env/server` — see change #2).

**Contract**: `defineConfig` with `test.include: ["src/**/*.integration.test.ts"]`, `test.environment: "node"`, `test.globalSetup` (or `setupFiles`) pointing at the bootstrap (change #3), and the `@/*` resolve alias. Decide env handling per change #2.

#### 2. Test env wiring for local Supabase

**File**: `src/test/integration/env.ts` (new) + `vitest.integration.config.ts`

**Intent**: Supply the local Supabase URL, anon key, and **test-only service-role key** to the suite. The handler slices import `@/lib/supabase`, which reads `SUPABASE_URL`/`SUPABASE_KEY` from `astro:env/server`; the integration config must alias `astro:env/server` to a stub that returns the **real local** anon key/URL (not the dummy generation stub), so the mocked `createClient` can still build a real client when a test opts to.

**Contract**: A small module exporting `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` resolved from env (e.g. `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY`), with a clear fail-fast error naming `npx supabase start` when absent. Document the expected source (the `supabase start` / `supabase status` output). Add an `astro:env/server` integration stub (new `src/test/stubs/astro-env-server.integration.ts`) that re-exports the real local URL + anon key.

#### 3. Global setup: seed + sign in users A and B

**File**: `src/test/integration/setup.ts` (new)

**Intent**: Idempotently create two fixed learner identities via the admin API and expose signed-in clients for both, so every spec gets `clientA`/`clientB` (anon-key clients carrying real JWTs) and their user ids. Idempotent so re-runs reuse the same users (per-run unique data, fixed users).

**Contract**: Using `@supabase/supabase-js` `createClient` with the service-role key, `auth.admin.createUser({ email, password, email_confirm: true })` for two fixed emails (e.g. `learner-a@test.local`, `learner-b@test.local`); swallow "already exists" so re-runs are safe. Then build two anon-key clients and `signInWithPassword` each to obtain authed clients. Export `{ clientA, clientB, userAId, userBId, adminClient }` for specs (via a module export the setup populates, or Vitest's provide/inject). `enable_confirmations = false` means no email step.

#### 4. Owned-row factory

**File**: `src/test/integration/factories.ts` (new)

**Intent**: Create a fully-owned session graph (session + material + theory + one MCQ exercise) for a given authed client, returning the inserted ids, so isolation specs have an owner's row for the other identity to attack. Insert through the **owner's** client so RLS `with check` stamps ownership naturally.

**Contract**: `createSessionGraph(client, overrides?)` → `{ sessionId, materialId, contentId, exerciseId }`. Inserts mirror the columns the real handlers write (`sessions.user_id/status/title/...`; `exercises.session_id/kind/position/prompt/options/correct_answer/feedback`, per `index.ts:106-160` and the baseline migration). `correct_answer`/`options` are `jsonb`. No `user_id` passed explicitly is needed if the client is the owner and RLS fills the check — but pass `user_id` to match handler behavior; the factory's caller is always the row's owner.

#### 5. `test:integration` script

**File**: `package.json`

**Intent**: A separate command to run the DB suite, leaving `test` (the required default gate) untouched.

**Contract**: `"test:integration": "vitest run --config vitest.integration.config.ts"` (and optionally `test:integration:watch`). Do not add it to `test`.

### Success Criteria:

#### Automated Verification:

- Default suite unaffected and green without Supabase: `npm test`
- Type checking passes: `npx astro check` (or `npm run lint`)
- Linting passes: `npm run lint`
- With local Supabase started (`npx supabase start`), the integration runner discovers and executes 0 failures on an empty suite: `npm run test:integration`

#### Manual Verification:

- `npx supabase status` keys match what `src/test/integration/env.ts` expects; a missing-env run fails fast with a message naming `npx supabase start`.
- Re-running `npm run test:integration` twice in a row reuses users A/B without "user already exists" errors.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the local-Supabase bootstrap works on the author's machine before proceeding.

---

## Phase 2: RLS-layer two-identity isolation (load-bearing)

### Overview

The core isolation guarantee. With A owning a session graph, prove B cannot read or mutate any of A's rows, and cannot forge ownership on insert — directly at the RLS layer, the cheapest layer that actually exercises the contract.

### Changes Required:

#### 1. Cross-learner read/mutate isolation spec

**File**: `src/test/integration/rls-isolation.integration.test.ts` (new)

**Intent**: Assert per-table isolation across the full session graph using A's owned rows and B's authed client.

**Contract**: For each of `sessions`, `materials`, `generated_content`, `exercises`, and `profiles`:
- **Read denied:** `clientB.from(table).select(...).eq("id", aRowId)` returns `data` of length 0 (and `clientA` returns length 1 — the owner-can positive control).
- **Update denied:** `clientB.from(table).update({...}).eq("id", aRowId).select()` returns 0 rows affected (no error, empty data — matches the RLS-blocked-UPDATE behavior).
- **Delete denied:** `clientB.from(table).delete().eq("id", aRowId).select()` returns 0 rows affected; the row still exists when re-read by A.

**Behavior asserted**: a non-owner gets nothing (read) and changes nothing (write) on every domain table.
**Regression caught**: a dropped/loosened `*_select_own`/`*_update_own`/`*_delete_own` policy, or a missing `enable row level security` on a table.
**Research source**: research §"The RLS policies are the contract under test"; migration `:36-153`; Architecture Insight "authorization is a database concern".
**Edge/error case**: RLS-blocked UPDATE/DELETE return **0 rows, no error** (assert affected-count, not thrown error).
**Anti-pattern avoided**: testing only that the owner CAN read — every table has the non-owner-denied assertion as the load-bearing one, with owner-can only as a control.

#### 2. Forged-ownership insert spec

**File**: `src/test/integration/rls-isolation.integration.test.ts` (same file)

**Intent**: Prove the `insert with check` guard blocks B from creating a row stamped with A's `user_id` (the create-path attack the `sessions` POST relies on RLS to stop).

**Contract**: `clientB.from("sessions").insert({ user_id: userAId, ... }).select()` returns an **error** (RLS `with check` violation); no row is created for A.

**Behavior asserted**: a learner cannot forge another learner's ownership on create.
**Regression caught**: a dropped/loosened `*_insert_own` `with check`.
**Research source**: research table row for `sessions/index.ts` (`:63`, `:185`); migration `sessions_insert_own` `:41-42`.
**Edge/error case**: insert violating `with check` raises an error (unlike update/delete which silently affect 0 rows) — assert error present.
**Anti-pattern avoided**: assuming "logged-in implies authorized" — B is authenticated yet still blocked.

### Success Criteria:

#### Automated Verification:

- Isolation spec passes against local Supabase: `npm run test:integration`
- Owner-can controls pass (rows are genuinely reachable by their owner), proving the denials are not vacuous.
- Default suite still green: `npm test`

#### Manual Verification:

- Temporarily loosening one policy locally (e.g. dropping `sessions_select_own`) makes the corresponding read-denied assertion fail — confirming the test has real signal. Revert after.

**Implementation Note**: Pause for manual confirmation (including the loosen-a-policy signal check) before proceeding.

---

## Phase 3: Handler-layer 404-translation slices

### Overview

Pin the `.single()`-error → 404 translation in the two read+mutate handlers, driven by user B against user A's ids. RLS stays live (real authed client); only `createClient` construction is mocked.

### Changes Required:

#### 1. `complete.ts` isolation slice

**File**: `src/pages/api/sessions/[id]/complete.integration.test.ts` (new)

**Intent**: Invoke the real `POST` handler as B against A's session id; assert 404 + no leaked score/row data, plus an owner-200 control.

**Contract**: `vi.hoisted` + `vi.mock("@/lib/supabase", ...)` returning a real anon-key client authed as B (spread `importOriginal` to keep any other exports). Build a fake `context` (`{ locals: { user: { id: userBId } }, params: { id: aSessionId }, request: new Request(...), cookies: <shim> }`) cast to the handler's param type; call `POST(context)`. Assert `res.status === 404` and the JSON body carries no session fields (only `{ error }`). Owner control: same handler with B's own session → `200` + `{ score }`.

**Behavior asserted**: a non-owner hitting `complete` gets 404, not another learner's score.
**Regression caught**: a handler change that swallows the `.single()` error and returns 200/empty, or returns a different code that leaks existence.
**Research source**: `complete.ts:35-40,53-56`; research §"Quoted enforcement points".
**Edge/error case**: the RLS-blocked UPDATE path is never reached because the read gate 404s first — the test confirms the **read gate** is the protection.
**Anti-pattern avoided**: mocking the Supabase client to bypass RLS — here the mocked `createClient` returns a **real** RLS-live client (documented inline); and the owner-200 control prevents a vacuous 404.

#### 2. `exercises/[exerciseId].ts` isolation slice

**File**: `src/pages/api/sessions/[id]/exercises/[exerciseId].integration.test.ts` (new)

**Intent**: Same approach for the MCQ-answer endpoint, including the `session_id`-mismatch edge case unique to this route.

**Contract**: As above, with `params: { id: aSessionId, exerciseId: aExerciseId }` and a valid `{ answer }` body. Assert 404 + no leaked `correct_answer`/`feedback`. **Edge case:** B passes A's `exerciseId` with B's *own* `sessionId` → still 404 (the `.eq("session_id", sessionId)` belt-and-braces match). Owner control: B answering B's own exercise → 200 + feedback.

**Behavior asserted**: a non-owner cannot read or record an answer on another learner's exercise, even by mixing their own session id with a victim's exercise id.
**Regression caught**: removal of the `.eq("session_id", ...)` guard, or a change that leaks `correct_answer`/`feedback` before the ownership check.
**Research source**: `exercises/[exerciseId].ts:44-49,57-65`; research line 89 (belt-and-braces match).
**Edge/error case**: id-mixing (own session + victim exercise) — the route-specific defense.
**Anti-pattern avoided**: same as #1 — real RLS-live client, owner-200 control proves the 404 is meaningful.

### Success Criteria:

#### Automated Verification:

- Both handler slices pass against local Supabase: `npm run test:integration`
- Owner-200 controls pass in both files.
- Default suite still green: `npm test`
- Linting passes: `npm run lint`

#### Manual Verification:

- The `vi.mock` factory documents (inline comment) why returning a real authed client is not the forbidden anti-pattern.
- Asserting on a non-existent id also yields 404, confirming the 404 is the uniform non-enumerable response.

**Implementation Note**: Pause for manual confirmation before the cookbook update.

---

## Phase 4: Cookbook update (test-plan.md §6.3 + §6.7)

### Overview

Capture the pattern so the next contributor can add an API-isolation test without re-deriving the harness. Mandatory final sub-phase per the rollout chain.

### Changes Required:

#### 1. §6.3 API endpoint cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.3 "TBD" with the concrete pattern: where DB-backed specs live (`*.integration.test.ts`), how to run them (`npm run test:integration` with local Supabase started), the two-identity bootstrap (`src/test/integration/setup.ts`), the owned-row factory, the RLS-layer-first rule, and the handler-slice `vi.mock createClient → real authed client` pattern with its "not the anti-pattern" caveat. Name the reference specs.

**Contract**: Rewritten §6.3 prose mirroring the depth of the existing §6.2; reference `rls-isolation.integration.test.ts` and the two handler slices; state "assert 404 + no row data, never 403" and "non-owner-denied is the load-bearing assertion".

#### 2. §6.7 per-phase note + §4 stack row

**File**: `context/foundation/test-plan.md`

**Intent**: Append a 2–3 line Phase 2 note to §6.7 (key surprises: protection is RLS-only so the suite must hit real Postgres; denial is 404 via `.single()`-on-empty; RLS-blocked UPDATE/DELETE return 0 rows with no error while forged INSERT errors; suite is local-only first). Update the §4 "API / route integration: none yet — see Phase 2" row to point at the new harness.

**Contract**: New §6.7 bullet `**Phase 2 (cross-learner isolation):** ...`; §4 row value changed from "none yet — see Phase 2" to name the integration config/script and the local-Supabase requirement (keep the `checked:` discipline of the table).

### Success Criteria:

#### Automated Verification:

- §6.3 no longer reads "TBD — see §3 Phase 2": `grep -n "TBD" context/foundation/test-plan.md` shows §6.3 resolved.
- Markdown formats cleanly: `npx prettier --check context/foundation/test-plan.md` (or `npm run format` then verify no diff churn beyond intended edits).

#### Manual Verification:

- A reader unfamiliar with the harness can follow §6.3 to add a new endpoint isolation test (start Supabase → write `*.integration.test.ts` → use `setup.ts` clients + factory → assert 404/0-rows).
- §6.7 note and §4 row accurately reflect what shipped.

**Implementation Note**: This is the final sub-phase; on completion the orchestrator marks §3 Phase 2 `complete`.

---

## Testing Strategy

### Unit Tests:

- None new — Phase 2 is integration-only by nature (the contract is in Postgres RLS; a unit test cannot exercise it).

### Integration Tests:

- **RLS layer** (`rls-isolation.integration.test.ts`): per-table non-owner read/update/delete denial + owner-can controls + forged-insert rejection.
- **Handler layer** (`complete.integration.test.ts`, `exercises/[exerciseId].integration.test.ts`): 404 translation, no data leak, `session_id`-mismatch edge case, owner-200 controls.

### Manual Testing Steps:

1. `npx supabase start`, then `npm run test:integration` — all isolation specs pass.
2. Loosen one RLS policy locally → the matching assertion fails (signal check) → revert.
3. `npm test` (no Supabase) — default suite unaffected.

## Performance Considerations

- DB-backed specs are slower than the seam-mocked unit tests; keeping them in a separate `test:integration` config preserves the fast default loop and avoids a hard Supabase dependency for everyday `npm test`.
- Per-run unique data (fixed users) avoids full `db reset` overhead; orphan rows accumulate harmlessly and are cleared by an occasional `supabase db reset`.

## Migration Notes

- No schema or data migrations. The suite reads the existing migrations + RLS as its contract; it must run against a DB that has them applied (local `supabase start` applies migrations + `seed.sql`).

## References

- Research: `context/changes/testing-cross-learner-isolation/research.md`
- Change identity: `context/changes/testing-cross-learner-isolation/change.md`
- Test plan: `context/foundation/test-plan.md` (§2 Risk #3, §3 Phase 2, §6.3, §6.7)
- Phase 1 harness pattern (vi.hoisted / importOriginal): `src/test/generation/openrouter-mock.ts`, `src/lib/services/generation/generate.session.test.ts`
- Enforcement points: `src/pages/api/sessions/[id]/complete.ts:35-56`, `src/pages/api/sessions/[id]/exercises/[exerciseId].ts:44-65`, `src/pages/api/sessions/index.ts:106-160`
- RLS contract: `supabase/migrations/20260528202720_domain_schema_rls_baseline.sql:36-153`, `supabase/migrations/20260609100000_profiles_bio.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB-backed integration harness

#### Automated

- [x] 1.1 Default suite unaffected and green without Supabase: `npm test`
- [x] 1.2 Type checking passes: `npx astro check`
- [x] 1.3 Linting passes: `npm run lint`
- [x] 1.4 Integration runner executes against started local Supabase: `npm run test:integration`

#### Manual

- [x] 1.5 `supabase status` keys match `env.ts`; missing-env run fails fast naming `npx supabase start`
- [x] 1.6 Re-running `test:integration` twice reuses users A/B without "already exists" errors

### Phase 2: RLS-layer two-identity isolation

#### Automated

- [ ] 2.1 Isolation spec passes against local Supabase: `npm run test:integration`
- [ ] 2.2 Owner-can controls pass (denials are not vacuous)
- [ ] 2.3 Default suite still green: `npm test`

#### Manual

- [ ] 2.4 Loosening one policy locally fails the matching assertion (signal check); revert after

### Phase 3: Handler-layer 404-translation slices

#### Automated

- [ ] 3.1 Both handler slices pass against local Supabase: `npm run test:integration`
- [ ] 3.2 Owner-200 controls pass in both files
- [ ] 3.3 Default suite still green: `npm test`
- [ ] 3.4 Linting passes: `npm run lint`

#### Manual

- [ ] 3.5 `vi.mock` factory documents why a real authed client is not the forbidden anti-pattern
- [ ] 3.6 Non-existent id also yields 404 (uniform non-enumerable response)

### Phase 4: Cookbook update (test-plan.md §6.3 + §6.7)

#### Automated

- [ ] 4.1 §6.3 no longer reads "TBD — see §3 Phase 2"
- [ ] 4.2 Markdown formats cleanly: `npx prettier --check context/foundation/test-plan.md`

#### Manual

- [ ] 4.3 A reader can follow §6.3 to add a new endpoint isolation test
- [ ] 4.4 §6.7 note and §4 row accurately reflect what shipped
