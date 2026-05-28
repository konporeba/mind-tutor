# Domain Schema + Per-Learner RLS Baseline — Implementation Plan

## Overview

This is the first migration in the project. It establishes the minimum domain schema for the MindTutor session loop — `sessions`, `materials`, `generated_content`, `exercises` — with per-learner Row Level Security, and documents the RLS policy template that every downstream slice (S-01 onward) copies instead of re-deriving. Getting per-learner isolation right on the first table is the whole point: the roadmap's headline risk is that a wrong RLS pattern propagates to five future tables. We foundationize the correct pattern, prove it with an automated cross-account test, and write it down.

## Current State Analysis

- **`supabase/migrations/` does not exist yet** — there are zero migrations; `npx supabase migration new` creates the directory on first use. `supabase/config.toml` exists (Postgres major version 17, project_id `10x-astro-starter`). The `supabase` CLI v2.23.4 is a devDependency.
- **Flat user model.** `src/middleware.ts` resolves `context.locals.user` from `supabase.auth.getUser()`. RLS keys off `auth.uid()`. There is no `profiles` table and none is needed here — bio is S-03's job, password-change S-09's.
- **The Supabase client is untyped.** `src/lib/supabase.ts` calls `createServerClient(SUPABASE_URL, SUPABASE_KEY, …)` with no `Database` generic. There is no `src/types.ts` and no generated `database.types.ts`, despite CLAUDE.md stating shared types live in `src/types.ts`. This change sets the typed-client convention.
- **`docs/reference/` does not exist.** CLAUDE.md references `docs/reference/contract-surfaces.md` as a "load-bearing names registry," but the directory is absent. The RLS template doc is greenfield.
- **No `context/foundation/lessons.md`** — no prior accepted rules constrain this design.
- **Downstream coupling that shapes F-01 decisions:** S-01 persists the upload→generate→exercise→score loop into these tables; S-06 reads them (cross-account read must be denied); S-07 hard-deletes a session and all children plus Storage objects (FR-016, hard-delete, confirmation required).

## Desired End State

After this plan:

1. A single migration in `supabase/migrations/` creates `sessions`, `materials`, `generated_content`, `exercises`, each with a denormalized `user_id uuid not null references auth.users(id) on delete cascade`, RLS enabled, and four policies (`select` / `insert` / `update` / `delete`) scoped to `user_id = (select auth.uid())` for the `authenticated` role.
2. `supabase db reset` (or `supabase migration up`) applies the migration cleanly against a local instance.
3. An automated SQL test proves that learner A cannot SELECT, UPDATE, or DELETE learner B's rows across all four tables, and that the `anon` role sees nothing.
4. `src/db/database.types.ts` is generated and committed; `createClient` returns a `SupabaseClient<Database>`; the project typechecks.
5. `docs/reference/rls-policy-template.md` documents the proven copy-paste RLS block + per-table conventions + the verification recipe, and `docs/reference/contract-surfaces.md` registers the four table names.

**Verification of end state:** `supabase test db` passes; `npx astro check` (or `npm run build`) passes with the typed client; both doc files exist and the template block in the doc is byte-identical in shape to what the migration applied.

### Key Discoveries:

- Empty `supabase/migrations/` — `src/lib/supabase.ts:9` constructs an untyped `createServerClient`. This plan changes that call site to add the `Database` generic.
- `astro.config.mjs` declares `SUPABASE_URL` / `SUPABASE_KEY` as **optional** secrets; `createClient` returns `null` when absent (`src/lib/supabase.ts:6-8`). The typed-client change must preserve this null-return guard.
- `package.json` has no `test` script and no `supabase` npm script — verification commands invoke the `supabase` CLI directly (`npx supabase …`).
- Two cascade paths exist on child tables by design (FK to `sessions` and the denormalized `user_id` FK to `auth.users`, both `ON DELETE CASCADE`). Both resolve to deletion; they do not conflict.

## What We're NOT Doing

- **No Supabase Storage bucket or storage RLS.** `materials.storage_path` is a nullable forward-hook column; the bucket + storage policies land with S-01 when upload is actually built.
- **No `profiles` table, no `bio` column** (S-03), **no per-session intake params** (S-02), **no multi-type exercise specifics beyond a `kind` column** (S-04), **no conversation-log table** (S-05 / persistence). These are later slices; speculatively modeling them is scope creep.
- **No API routes, services, or UI.** F-01 is schema + RLS + types + docs only.
- **No application-level integration test** — there is no domain API/UI to call yet. Isolation is proven at the database layer, where Postgres actually enforces RLS.
- **No soft-delete.** PRD FR-016 settled hard-delete; cascade handles it.

## Implementation Approach

One baseline migration creates all four tables and their RLS in a single file, because they form one cohesive ownership unit and the RLS block is the deliverable being templated. Immediately after, an automated SQL test proves cross-account isolation — front-loaded as Phase 2 because it validates the roadmap's highest risk before any further work builds on the schema. Then the client is typed from the generated schema, and finally the proven pattern is documented (documenting *after* proving avoids enshrining an untested template).

The RLS pattern is **denormalized `user_id` on every table** with a uniform policy `user_id = (select auth.uid())`. The `(select …)` wrapper is deliberate — Postgres caches it per-statement, which is Supabase's documented performance guidance for RLS. Uniformity is the feature: a new table in any future slice copies the same four-policy block verbatim.

## Critical Implementation Details

- **`auth.uid()` must be wrapped as `(select auth.uid())`** in every policy. The bare form re-evaluates per row; the subselect form is cached per statement. This is the single non-obvious correctness/performance detail in the template and must be identical in the migration and the doc.
- **Insert policies use `WITH CHECK`, not `USING`.** A `user_id`-ownership insert policy that only sets `USING` silently fails to constrain the inserted row. Each table needs `with check (user_id = (select auth.uid()))` on its insert policy.
- **Migration timestamp ordering.** Generate the file with `npx supabase migration new domain_schema_rls_baseline` so the `YYYYMMDDHHmmss_` prefix is correct and monotonic; do not hand-name it.

## Phase 1: Schema + RLS Migration

### Overview

Create the four tables with pragmatic columns sized to the known session loop, denormalized `user_id`, FK cascades, `user_id` indexes, and the uniform RLS policy block on each table.

### Changes Required:

#### 1. Baseline migration file

**File**: `supabase/migrations/<generated>_domain_schema_rls_baseline.sql` (create via `npx supabase migration new domain_schema_rls_baseline`)

**Intent**: Stand up the minimum domain schema and enforce per-learner isolation on every table from day one. Pragmatic columns let S-01 build the upload→generate→exercise→score loop against a real schema; anything S-01 needs beyond this is an additive migration.

**Contract**: Four tables, all with `id uuid primary key default gen_random_uuid()`, `user_id uuid not null references auth.users(id) on delete cascade`, `created_at timestamptz not null default now()`.

- `sessions` — adds `status text not null default 'active'` (check constraint: `'active' | 'completed' | 'abandoned'`), `score int` (nullable; final percentage, FR-011), `title text` (nullable), `completed_at timestamptz` (nullable), `updated_at timestamptz not null default now()`.
- `materials` — adds `session_id uuid not null references sessions(id) on delete cascade`, `filename text not null`, `mime_type text not null`, `size_bytes bigint not null`, `storage_path text` (nullable forward hook for S-01 Storage).
- `generated_content` — adds `session_id uuid not null references sessions(id) on delete cascade`, `kind text not null` (check: `'theory' | 'exercise'`; represents the milestone sequence, FR-013), `position int not null` (ordering within the session), `body jsonb not null default '{}'` (flexible payload so S-01/S-04 don't re-migrate for content shape).
- `exercises` — adds `session_id uuid not null references sessions(id) on delete cascade`, `kind text not null default 'mcq'` (MCQ for S-01; S-04 extends), `position int not null`, `prompt text not null`, `options jsonb` (nullable; MCQ choices), `correct_answer jsonb` (nullable), `learner_answer jsonb` (nullable), `is_correct boolean` (nullable), `feedback text` (nullable), `answered_at timestamptz` (nullable).

Each table also gets: `create index … on <table> (user_id)`; `alter table <table> enable row level security`; and four policies for role `authenticated` named `<table>_select_own` / `_insert_own` / `_update_own` / `_delete_own`. The canonical block (this is the template — see Phase 4):

```sql
alter table public.<table> enable row level security;

create policy "<table>_select_own" on public.<table>
  for select to authenticated using (user_id = (select auth.uid()));

create policy "<table>_insert_own" on public.<table>
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "<table>_update_own" on public.<table>
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "<table>_delete_own" on public.<table>
  for delete to authenticated using (user_id = (select auth.uid()));
```

No policies are granted to `anon` — RLS default-deny leaves the `anon` role with no access, which is the intended unauthenticated behavior.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly from scratch: `npx supabase db reset`
- All four tables report `rowsecurity = true` (query `pg_tables` after reset)
- Each table has exactly four policies (query `pg_policies`)
- Build/typecheck unaffected: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- The four-policy block is identical across all four tables (only the table name differs)
- Every insert policy uses `with check`, every select/delete uses `using`, update uses both
- `auth.uid()` is wrapped as `(select auth.uid())` in every policy
- Column set matches the "pragmatic loop" scope — no speculative S-02/S-03/S-04 columns crept in

**Seed-file note**: `supabase/config.toml` has `[db.seed] enabled = true` pointing at `./seed.sql`, but no `supabase/seed.sql` exists yet. Before relying on `db reset`, confirm it tolerates the missing seed file (recent CLI versions warn-and-continue); if it errors, add an empty `supabase/seed.sql` rather than disabling the seed config.

**Implementation Note**: After Phase 1 automated verification passes, pause for manual confirmation that the policy block and column scope are correct before proceeding. The schema shape locked here is what Phase 3 generates types from and Phase 4 documents.

---

## Phase 2: Automated Per-Learner Isolation Test

### Overview

Prove the highest-risk decision — that RLS actually isolates learners — with a repeatable SQL test, before any further work builds on the schema.

### Changes Required:

#### 1. Isolation test

**File**: `supabase/tests/rls_isolation_test.sql`

**Intent**: Demonstrate that an authenticated learner cannot read, modify, or delete another learner's rows in any of the four tables, and that the test fails loudly if a future schema change weakens a policy. This is the executable proof behind the documented template.

**Contract**: A pgTAP test run by `supabase test db`. It seeds two `auth.users` rows (user A, user B), inserts at least one owned row per user into each of the four tables (as the table owner / service role, bypassing RLS for setup), then for each table impersonates user A by setting the request role to `authenticated` and the JWT claims (`set local role authenticated; set local request.jwt.claims = '{"sub":"<A>"}'`) and asserts:

- A `select` returns only A's rows (B's row count is 0) — `results_eq` / `is`.
- An `update` targeting B's row affects 0 rows.
- A `delete` targeting B's row affects 0 rows.
- A reset to the `anon` role returns 0 rows from every table.

Use the pgTAP plan count matching the number of assertions. The test must `rollback` (pgTAP wraps in a transaction) so it is repeatable.

**Test mechanics (the fiddly bits — get these right or the file won't run):**

- **Role switching requires `reset role` between impersonations.** The `authenticated` role is not a superuser and cannot `SET ROLE anon`. The test runs as the `postgres` superuser, so the sequence is: seed as superuser → `set local role authenticated` + claims (impersonate A, run A's assertions) → **`reset role`** (back to superuser) → `set local role anon` (run the no-access assertions). Skipping the `reset role` yields `permission denied to set role "anon"`.
- **Seeding `auth.users` needs the NOT-NULL column set explicitly.** Inserting only `(id)` fails — the local Supabase `auth.users` table has additional NOT NULL columns. Insert at minimum `id, instance_id, aud, role, email` (and confirm against the local schema, which can vary by Supabase image version), e.g. `insert into auth.users (id, instance_id, aud, role, email) values ('…A', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local');`. Do not rely on `(id)`-only inserts.
- **Prove 0-effect, don't rely on "no error".** RLS makes a filtered `update`/`delete` a silent no-op (0 rows, no exception). Assert the effect, not the absence of error: run the `update`/`delete` targeting B's row, then `results_eq` B's row read back as the superuser to confirm it is unchanged / still present — or capture `GET DIAGNOSTICS rows = ROW_COUNT` and assert `rows = 0`. A `lives_ok`-style assertion is not sufficient.

```sql
-- shape only; the impersonation primitive that makes RLS testable:
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000A"}';
-- ... A's assertions ...
reset role;                 -- MUST reset before switching to anon
set local role anon;
-- ... anon no-access assertions ...
```

### Success Criteria:

#### Automated Verification:

- Isolation test passes: `npx supabase test db`
- The test fails when run against a table with RLS disabled (sanity-check by temporarily disabling once during development, then re-enable — do not commit the disabled state)

#### Manual Verification:

- The test covers all four tables for all three operations (select / update / delete) plus the `anon` no-access case
- Assertions check *counts/effects*, not just absence of error (a permissive policy returning B's rows must fail the test)

**Implementation Note**: After Phase 2 passes, pause for manual confirmation that the test genuinely exercises cross-account denial (not just "no error thrown") before proceeding.

---

## Phase 3: Typed Supabase Client

### Overview

Generate TypeScript types from the applied schema and wire them into the client so every downstream slice gets compile-time row-shape safety.

### Changes Required:

#### 1. Generated database types

**File**: `src/db/database.types.ts`

**Intent**: Establish the typed-client convention at the foundation. Generated from the live local schema so it can't drift from the migration.

**Contract**: Output of `npx supabase gen types typescript --local > src/db/database.types.ts`, exporting the `Database` type. Committed to the repo. Regenerated whenever a migration changes the schema (note this in the doc, Phase 4).

#### 2. Typed client factory

**File**: `src/lib/supabase.ts`

**Intent**: Parametrize the SSR client with the generated `Database` type while preserving the existing null-return guard when env secrets are absent.

**Contract**: `createServerClient<Database>(...)`; import `Database` from `@/db/database.types`. The function still returns `null` when `SUPABASE_URL`/`SUPABASE_KEY` are unset (`src/lib/supabase.ts:6-8` behavior unchanged). The return type becomes `SupabaseClient<Database> | null`.

#### 3. Shared row-type surface (optional convenience)

**File**: `src/types.ts`

**Intent**: Per CLAUDE.md, shared entity types live in `src/types.ts`. Re-export convenient row aliases (e.g. `type Session = Database["public"]["Tables"]["sessions"]["Row"]`) so downstream slices import domain types from one place rather than reaching into the generated file.

**Contract**: Thin re-export module deriving aliases from `Database`. No hand-authored shapes that could drift.

### Success Criteria:

#### Automated Verification:

- Type generation succeeds and file is non-empty: `npx supabase gen types typescript --local`
- Typecheck passes: `npx astro check` (or `npm run build`)
- Lint passes: `npm run lint`

#### Manual Verification:

- `createClient(...)` consumers get autocomplete on table names and row fields
- The null-return guard still works when env vars are unset (client is `null`, no throw)

**Implementation Note**: After Phase 3 passes, pause for manual confirmation that the typed client behaves identically at runtime (null guard intact) before proceeding.

---

## Phase 4: RLS Template Documentation

### Overview

Document the proven RLS pattern as the canonical reference downstream slices extend, and register the new table names.

### Changes Required:

#### 1. RLS policy template doc

**File**: `docs/reference/rls-policy-template.md`

**Intent**: Give every future `/10x-plan` and implementer one canonical place to copy the per-learner RLS pattern from, so no slice re-derives it. Documents the *proven* block from Phase 1/2, not a guess.

**Contract**: A reference doc containing: (a) the copy-paste enable-RLS + four-policy block with a `<table>` placeholder; (b) the per-table conventions — denormalized `user_id uuid not null references auth.users(id) on delete cascade`, `create index on <table>(user_id)`, policy naming `<table>_<op>_own`, role `authenticated`, `(select auth.uid())` wrapper, `with check` on insert/update; (c) the verification recipe — how to add the table to `supabase/tests/rls_isolation_test.sql` and run `supabase test db`; (d) a "regenerate types after every migration" reminder pointing at Phase 3's command.

#### 2. Contract-surfaces registry

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Register the four table names (and the `user_id` ownership convention) in the load-bearing-names registry CLAUDE.md points at, so renames are caught.

**Contract**: Create the file if absent (the directory does not exist yet). Add an entry listing `sessions`, `materials`, `generated_content`, `exercises` as domain tables, noting each carries an owning `user_id` and links to `rls-policy-template.md`.

### Success Criteria:

#### Automated Verification:

- Both files exist: `ls docs/reference/rls-policy-template.md docs/reference/contract-surfaces.md`
- Prettier formatting passes: `npm run format` (or `npx prettier --check docs/reference/*.md`)

#### Manual Verification:

- The template block in the doc is shape-identical to what Phase 1's migration applied (same policy names, same `(select auth.uid())`, same `with check` placement)
- A reader unfamiliar with the project could add a new per-learner table by copying the doc alone
- The four table names in `contract-surfaces.md` match the migration exactly

**Implementation Note**: After Phase 4, pause for manual confirmation that the documented template matches the shipped migration before closing the change.

---

## Testing Strategy

### Unit / Database Tests:

- pgTAP isolation test (`supabase/tests/rls_isolation_test.sql`) — cross-account SELECT/UPDATE/DELETE denial across all four tables plus the `anon` no-access case.

### Integration Tests:

- None in F-01 — there is no domain API or UI yet. Application-level cross-account read tests are S-06's responsibility, building on this template.

### Manual Testing Steps:

1. `npx supabase db reset` and confirm all four tables exist with RLS enabled (`select tablename, rowsecurity from pg_tables where schemaname='public'`).
2. `npx supabase test db` and confirm the isolation test passes.
3. In the Supabase Studio SQL editor, impersonate user A (`set request.jwt.claims`) and confirm a `select * from sessions` cannot see a row owned by user B.
4. `npx astro check` and confirm the typed client compiles with autocomplete.

## Performance Considerations

- The `(select auth.uid())` wrapper is the performance-critical detail — it lets Postgres cache the auth lookup per statement instead of per row.
- `user_id` is indexed on every table so RLS predicates and ownership lookups stay index-backed as data grows (data volume is `small` per PRD, so this is precautionary, not a hotspot).

## Migration Notes

- This is the first migration; there is no existing data to migrate.
- Both child-table cascade paths (`session_id → sessions` and `user_id → auth.users`, both `ON DELETE CASCADE`) resolve to deletion and do not conflict. S-07 will rely on session-level cascade for row cleanup and handle Storage objects separately.
- Types must be regenerated (`supabase gen types`) after any future migration that touches these tables — captured in the template doc.

## References

- Change identity: `context/changes/domain-schema-rls-baseline/change.md`
- Roadmap F-01: `context/foundation/roadmap.md` (Foundations → F-01)
- PRD NFR (per-learner isolation) + Access Control (flat user model): `context/foundation/prd.md:151`, `:164`
- Untyped client call site: `src/lib/supabase.ts:9`
- Null-return guard to preserve: `src/lib/supabase.ts:6-8`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema + RLS Migration

#### Automated

- [x] 1.1 Migration applies cleanly from scratch: `npx supabase db reset` — 4a7b0c2
- [x] 1.2 All four tables report `rowsecurity = true` (`pg_tables`) — 4a7b0c2
- [x] 1.3 Each table has exactly four policies (`pg_policies`) — 4a7b0c2
- [x] 1.4 Build/typecheck unaffected: `npm run build` — 4a7b0c2
- [x] 1.5 Lint passes: `npm run lint` (pre-existing repo-wide CRLF prettier errors only; this phase adds no ESLint-covered files — no regression; CI on Linux is green) — 4a7b0c2

#### Manual

- [x] 1.6 The four-policy block is identical across all four tables (only the table name differs) — 4a7b0c2
- [x] 1.7 Insert uses `with check`, select/delete use `using`, update uses both — 4a7b0c2
- [x] 1.8 `auth.uid()` is wrapped as `(select auth.uid())` in every policy — 4a7b0c2
- [x] 1.9 Column set matches the pragmatic-loop scope — no speculative columns — 4a7b0c2

### Phase 2: Automated Per-Learner Isolation Test

#### Automated

- [x] 2.1 Isolation test passes: `npx supabase test db` — 9095dcc
- [x] 2.2 Test fails when run against a table with RLS disabled (sanity check, then re-enable) — 9095dcc

#### Manual

- [x] 2.3 Test covers all four tables for select/update/delete plus the `anon` no-access case — 9095dcc
- [x] 2.4 Assertions check counts/effects, not just absence of error — 9095dcc

### Phase 3: Typed Supabase Client

#### Automated

- [x] 3.1 Type generation succeeds and file is non-empty: `npx supabase gen types typescript --local` — ce693d9
- [x] 3.2 Typecheck passes: `npx astro check` (or `npm run build`) — ce693d9
- [x] 3.3 Lint passes: `npm run lint` (generated `database.types.ts` excluded via eslint ignore; hand-written files have only pre-existing CRLF prettier issues — no real errors; CI on Linux green) — ce693d9

#### Manual

- [x] 3.4 Consumers get autocomplete on table names and row fields — ce693d9
- [x] 3.5 Null-return guard still works when env vars are unset (client is `null`, no throw) — ce693d9

### Phase 4: RLS Template Documentation

#### Automated

- [x] 4.1 Both files exist: `docs/reference/rls-policy-template.md` and `docs/reference/contract-surfaces.md`
- [x] 4.2 Prettier formatting passes

#### Manual

- [x] 4.3 Documented template block is shape-identical to the shipped migration
- [x] 4.4 A reader could add a new per-learner table from the doc alone
- [x] 4.5 The four table names in `contract-surfaces.md` match the migration exactly
