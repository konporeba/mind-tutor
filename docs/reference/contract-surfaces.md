# Contract Surfaces

> Load-bearing names other code, migrations, tests, and AI agents depend on.
> Renaming anything here is a breaking change — grep the repo and update every
> reference before doing so.

## Domain tables (public schema)

All four are learner-owned and follow the per-learner RLS pattern in
[`rls-policy-template.md`](./rls-policy-template.md): each carries a denormalized
`user_id uuid not null references auth.users(id) on delete cascade`, an index on
`user_id`, RLS enabled, and the canonical four-policy block (`<table>_select_own`
/ `_insert_own` / `_update_own` / `_delete_own`, role `authenticated`).

Established in migration `supabase/migrations/20260528202720_domain_schema_rls_baseline.sql`
(roadmap F-01).

| Table               | Role                                                             | Owner column | Parent FK (cascade)     |
| ------------------- | ---------------------------------------------------------------- | ------------ | ----------------------- |
| `sessions`          | One learning session (the aggregate root).                       | `user_id`    | — (`user_id` → auth)    |
| `materials`         | Uploaded study files (metadata; bytes land in Storage via S-01). | `user_id`    | `session_id` → sessions |
| `generated_content` | AI-generated study steps (theory / exercise milestones).         | `user_id`    | `session_id` → sessions |
| `exercises`         | Practice items the learner answers, with per-exercise scoring.   | `user_id`    | `session_id` → sessions |

## Generated artifacts

| Name                       | What                                                        | Regenerate when                          |
| -------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `src/db/database.types.ts` | Supabase-generated `Database` type (typed client source).   | After any migration touching the schema. |
| `src/types.ts`             | Hand-maintained domain row aliases derived from `Database`. | When a new domain table is added.        |

## Tests

| Name                                    | What                                                            |
| --------------------------------------- | --------------------------------------------------------------- |
| `supabase/tests/rls_isolation_test.sql` | pgTAP cross-account isolation proof for the four domain tables. |
