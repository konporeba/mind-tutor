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

### Columns added after baseline

| Column                     | Added by                                          | Purpose                                                                |
| -------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| `materials.extracted_text` | `20260607150000_first_grounded_session.sql` (S-01) | Browser-parsed source text; grounds generation + citation validation. |

## Storage

| Bucket      | Visibility | Path convention                     | Owner policies                                                                                                    | Established in                                      |
| ----------- | ---------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `materials` | private    | `{user_id}/{session_id}/{filename}` | `materials_objects_{select,insert,update,delete}_own` on `storage.objects`; owner = `(storage.foldername(name))[1] = auth.uid()`. | `20260607150000_first_grounded_session.sql` (S-01) |

## Services (generation contract)

| Name                                        | What                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/lib/services/generation/schema.ts`     | Zod contract + types for a generated session (3–5 cited theory steps + 5 MCQs) and `TheoryBody`.  |
| `src/lib/services/generation/generate.ts`   | `generateSession(sourceText)` — grounded single call, zod + citation validation, one retry.      |
| `src/lib/services/generation/openrouter.ts` | OpenRouter client (`getOpenRouterClient`, `getModel`) + `GenerationError`.                        |
| `src/lib/services/scoring.ts`               | `computeScore(exercises)` — percent correct (FR-011).                                             |

Persistence mapping: each theory step → one `generated_content` row (`kind 'theory'`, `body` = `TheoryBody`); each MCQ → one `exercises` row (`kind 'mcq'`, `options` jsonb, `correct_answer` = the correct option string, `feedback`).

## API routes

| Route                                       | Method | What                                                                  |
| ------------------------------------------- | ------ | -------------------------------------------------------------------- |
| `/api/sessions`                             | POST   | Validate upload, generate, persist session + file + material + steps. |
| `/api/sessions/[id]/exercises/[exerciseId]` | POST   | Record an answer, return immediate feedback (FR-010).                 |
| `/api/sessions/[id]/complete`               | POST   | Compute + persist the session score (FR-011).                        |

## Environment variables

| Name                 | Access          | Purpose                                  |
| -------------------- | --------------- | ---------------------------------------- |
| `OPENROUTER_API_KEY` | server / secret | OpenRouter API key for generation.       |
| `OPENROUTER_MODEL`   | server / public | Model id (default `openai/gpt-4o-mini`). |

## Tests

| Name                                    | What                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/rls_isolation_test.sql` | pgTAP cross-account isolation proof for the four domain tables, the `materials` Storage bucket, and the `extracted_text` column (`plan(29)`). |
