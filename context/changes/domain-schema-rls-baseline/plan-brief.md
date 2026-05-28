# Domain Schema + Per-Learner RLS Baseline — Plan Brief

> Full plan: `context/changes/domain-schema-rls-baseline/plan.md`

## What & Why

Migrate the minimum domain schema for the MindTutor session loop — `sessions`, `materials`, `generated_content`, `exercises` — with per-learner Row Level Security, and document the RLS policy template every later slice copies. Getting per-learner isolation wrong on the first table propagates to every subsequent table; foundationizing the correct, proven pattern now is far cheaper than retrofitting once five tables exist (roadmap F-01's headline risk).

## Starting Point

`supabase/migrations/` is empty (this is the first migration). The Supabase client at `src/lib/supabase.ts` is untyped and there is no `database.types.ts`. Flat user model: middleware resolves `context.locals.user`; RLS keys off `auth.uid()`. No `profiles` table, no `docs/reference/` directory yet.

## Desired End State

Four tables exist, each with a denormalized `user_id`, FK cascade to `sessions`/`auth.users`, and a uniform four-policy RLS block. An automated SQL test proves learner A cannot read/update/delete learner B's rows. The Supabase client is typed from the generated schema. A reference doc captures the proven RLS template so S-01 and beyond extend it instead of re-deriving it.

## Key Decisions Made

| Decision                     | Choice                                               | Why (1 sentence)                                                                              | Source |
| ---------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ |
| RLS ownership model          | Denormalized `user_id` on every table                | Simplest, fastest (no joins), and the template copies verbatim to any future table.           | Plan   |
| Schema granularity           | Pragmatic columns sized to the known loop            | S-01 builds against a real schema; additive tweaks are cheap, speculative full-model isn't.   | Plan   |
| Storage bucket               | Deferred to S-01 (`materials.storage_path` hook)     | Storage RLS is best built with the upload code that exercises it; keeps F-01 to one surface.  | Plan   |
| TypeScript types             | Generate `database.types.ts` + typed client          | Sets the typed-client convention at the foundation; types can't drift from the migration.     | Plan   |
| Referential cleanup          | FK `ON DELETE CASCADE` (child→session, session→user) | S-07 inherits atomic DB cascade; PRD chose hard-delete, so soft-delete is out.                | Plan   |
| RLS template home            | `docs/reference/rls-policy-template.md` + registry   | Discoverable canonical place downstream `/10x-plan` runs cite; names registered for renames.  | Plan   |
| Isolation verification       | Automated SQL/pgTAP test on local Supabase           | Exercises RLS exactly as Postgres enforces it — the only real proof, repeatable in CI.        | Plan   |

## Scope

**In scope:** four tables + columns; denormalized `user_id`; FK cascades + `user_id` indexes; RLS enabled with 4 policies/table; automated cross-account isolation test; generated `database.types.ts` + typed client; RLS template doc + contract-surfaces registry.

**Out of scope:** Storage bucket/policies (S-01); `profiles`/bio (S-03); per-session intake params (S-02); conversation log (S-05); multi-type exercise specifics (S-04); any API route, service, or UI; soft-delete; application-level integration tests.

## Architecture / Approach

One baseline migration creates all four tables and their RLS together (they form one ownership unit and the RLS block is the deliverable being templated). Each child table carries both a `session_id` FK and a denormalized `user_id` FK, both `ON DELETE CASCADE`. Every policy uses `user_id = (select auth.uid())` for role `authenticated`; the `(select …)` wrapper is the load-bearing perf/correctness detail. Prove → type → document, in that order, so the documented template reflects a tested pattern.

## Phases at a Glance

| Phase                          | What it delivers                                            | Key risk                                                            |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| 1. Schema + RLS migration      | 4 tables, cascades, indexes, uniform RLS block              | A subtly weak policy (missing `with check`, bare `auth.uid()`)      |
| 2. Isolation test              | Automated cross-account denial proof across all 4 tables    | A test that passes on "no error" instead of checking row effects    |
| 3. Typed client                | `database.types.ts` + `createServerClient<Database>`        | Breaking the existing null-return guard when env vars are unset     |
| 4. Template documentation      | `rls-policy-template.md` + contract-surfaces registry       | Doc drifting from the shipped migration                             |

**Prerequisites:** Docker + `npx supabase start` available locally (needed for `db reset`, `test db`, and `gen types --local`).
**Estimated effort:** ~1 focused session across 4 small, well-gated phases.

## Open Risks & Assumptions

- Assumes local Supabase (Docker) is runnable; all automated verification depends on it. If only a remote project is available, type generation switches to `--project-id` and the isolation test runs against a throwaway remote schema.
- The pragmatic column set is a best guess at S-01's needs; some columns may be reshaped, but every change is an additive migration (low cost).
- pgTAP test ergonomics (role/JWT-claim impersonation) carry minor setup ceremony — bounded, but the first test file is the fiddly one.

## Success Criteria (Summary)

- `npx supabase db reset` applies the migration and all four tables report RLS enabled with four policies each.
- `npx supabase test db` proves a learner cannot reach another learner's rows in any table.
- The project typechecks against the generated `Database` type, and the RLS template doc lets a future slice add a per-learner table by copy alone.
