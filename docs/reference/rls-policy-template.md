# Per-Learner RLS Policy Template

> The canonical Row Level Security pattern for MindTutor domain tables.
> Established and proven in `domain-schema-rls-baseline` (roadmap F-01).
> Every table that holds learner-owned data copies this block verbatim.

MindTutor uses a **flat user model**: every signed-in user is a learner, and a
row belongs to exactly one learner. Isolation is enforced at the database layer
with RLS keyed off `auth.uid()`, so a learner can never reach another learner's
data through any product surface — even by guessing IDs.

The pattern is **denormalized ownership**: every table carries its own
`user_id`, and the policy is the same four-line block on every table. Uniformity
is the point — adding a new learner-owned table is a copy-paste, not a redesign.

## When to use it

Use this template for any new table whose rows are owned by a single learner
(sessions, materials, generated content, exercises, and anything similar a later
slice introduces). Do **not** use it for tables with a different access model
(e.g. shared/global lookup tables) — those need policies that match their real
access model, not this one.

## The column convention

Every learner-owned table includes these columns and an index on `user_id`:

```sql
id uuid primary key default gen_random_uuid(),
user_id uuid not null references auth.users (id) on delete cascade,
created_at timestamptz not null default now()
-- ... table-specific columns ...
```

```sql
create index <table>_user_id_idx on public.<table> (user_id);
```

- `user_id` is **denormalized onto every table** (not derived through a parent
  join). Child tables additionally FK to their parent with
  `session_id uuid not null references public.sessions (id) on delete cascade`,
  but RLS always keys off the table's own `user_id`.
- `on delete cascade` on the `user_id` FK means deleting an account removes its
  rows; the parent-session FK cascade is what per-session delete (S-07) relies on.

## The policy block (copy-paste)

Replace `<table>` with the table name. This block is byte-for-byte what the
baseline migration applies to each of the four domain tables.

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

### Why it is written this way (do not "simplify" these)

- **`(select auth.uid())`, not bare `auth.uid()`.** The subselect form is
  evaluated once per statement and cached; the bare form re-evaluates per row.
  This is a Supabase-documented performance practice.
- **`to authenticated`** scopes the policy to signed-in users. The `anon` role
  gets no policy, so RLS default-deny gives it zero rows. (`to authenticated`
  alone is _not_ enough — it must be paired with the `user_id` ownership
  predicate, or any authenticated user could read any row.)
- **`with check` on insert _and_ update.** Insert needs `with check` or the
  ownership constraint on the new row is not enforced. Update needs both
  `using` (which rows it may target) and `with check` (or a user could reassign
  a row's `user_id` to someone else).
- **Separate policy per operation.** One policy each for select / insert /
  update / delete keeps the intent explicit and auditable.

## Verifying isolation

Every learner-owned table must be covered by the isolation test before it ships.

1. Add the table to `supabase/tests/rls_isolation_test.sql`: seed one row owned
   by learner A and one owned by learner B, then assert (while impersonating A
   via `set local role authenticated` + a JWT `sub` claim) that A sees only its
   own row and that A's `update`/`delete` against B's row are 0-row no-ops.
   Assert the **effect** (B's row unchanged, read back as the superuser), not the
   absence of an error — a filtered write fails silently with no exception. Add
   an `anon` no-access assertion too. Bump the `plan(N)` count accordingly.
2. Run the test:

   ```bash
   npx supabase test db
   ```

3. Sanity-check that the test actually bites: temporarily
   `alter table public.<table> disable row level security;`, re-run — it must
   FAIL — then re-enable. Never commit the disabled state.

## After any migration: regenerate types

The typed Supabase client is generated from the live schema, so it drifts the
moment a migration changes a table. After applying a migration, regenerate:

```bash
npx supabase gen types typescript --local > src/db/database.types.ts
```

Then expose any new row types from `src/types.ts` (the hand-maintained alias
surface) rather than importing the generated file directly.
