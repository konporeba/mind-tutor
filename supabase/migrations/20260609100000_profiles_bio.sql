-- Profiles + onboarding bio (roadmap S-03, plan Phase 1).
--
-- One row per learner, keyed directly on the auth user. Holds the free-text bio
-- captured by the one-time conversational onboarding (FR-005) and an
-- `onboarded_at` marker the middleware gate reads to decide whether a learner
-- still needs onboarding. The bio is reused on every later session to tailor
-- generation idiom/depth (the bio half of FR-006).
--
-- Ownership model is the F-01 per-learner RLS template
-- (docs/reference/rls-policy-template.md), with one deliberate difference:
-- `profiles` is a 1:1 table, so the PRIMARY KEY *is* `user_id` (no separate
-- `id` column). The policy predicate still keys off `user_id = auth.uid()`.
-- The row is created lazily (upsert) at onboarding completion — no trigger on
-- auth.users.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  bio text,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));

create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "profiles_delete_own" on public.profiles
  for delete to authenticated using (user_id = (select auth.uid()));

-- Keep updated_at fresh on every UPDATE (moddatetime extension created by the
-- sessions trigger migration).
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function extensions.moddatetime(updated_at);
