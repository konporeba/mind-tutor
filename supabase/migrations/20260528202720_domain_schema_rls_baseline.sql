-- Domain schema + per-learner RLS baseline (roadmap F-01).
--
-- Establishes the minimum domain schema for the MindTutor session loop and the
-- per-learner Row Level Security pattern that every downstream slice extends.
--
-- Ownership model: every table carries a denormalized `user_id` referencing
-- auth.users(id). RLS isolates rows with `user_id = (select auth.uid())` for the
-- `authenticated` role. The `(select ...)` wrapper lets Postgres cache the auth
-- lookup once per statement instead of re-evaluating it per row.
--
-- Cascade model: child tables cascade on both their parent session
-- (session_id -> sessions) and the owning user (user_id -> auth.users). Both
-- paths resolve to deletion and do not conflict; session-level cascade is what
-- S-07 (delete session) relies on for row cleanup.
--
-- The canonical four-policy block below (enable RLS + select/insert/update/delete
-- for `authenticated`) is the template documented in
-- docs/reference/rls-policy-template.md and copied verbatim by future tables.

-- ============================================================================
-- sessions — one learning session per row (the aggregate root).
-- ============================================================================
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  score int,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index sessions_user_id_idx on public.sessions (user_id);

alter table public.sessions enable row level security;

create policy "sessions_select_own" on public.sessions
  for select to authenticated using (user_id = (select auth.uid()));

create policy "sessions_insert_own" on public.sessions
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "sessions_update_own" on public.sessions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "sessions_delete_own" on public.sessions
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================================
-- materials — uploaded study files (metadata; bytes live in Storage, added by S-01).
-- ============================================================================
create table public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_path text,
  created_at timestamptz not null default now()
);

create index materials_user_id_idx on public.materials (user_id);
create index materials_session_id_idx on public.materials (session_id);

alter table public.materials enable row level security;

create policy "materials_select_own" on public.materials
  for select to authenticated using (user_id = (select auth.uid()));

create policy "materials_insert_own" on public.materials
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "materials_update_own" on public.materials
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "materials_delete_own" on public.materials
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================================
-- generated_content — AI-generated study steps (theory / exercise milestones).
-- ============================================================================
create table public.generated_content (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  kind text not null check (kind in ('theory', 'exercise')),
  position int not null,
  body jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index generated_content_user_id_idx on public.generated_content (user_id);
create index generated_content_session_id_idx on public.generated_content (session_id);

alter table public.generated_content enable row level security;

create policy "generated_content_select_own" on public.generated_content
  for select to authenticated using (user_id = (select auth.uid()));

create policy "generated_content_insert_own" on public.generated_content
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "generated_content_update_own" on public.generated_content
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "generated_content_delete_own" on public.generated_content
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================================
-- exercises — practice items the learner answers, with per-exercise scoring.
-- ============================================================================
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  kind text not null default 'mcq',
  position int not null,
  prompt text not null,
  options jsonb,
  correct_answer jsonb,
  learner_answer jsonb,
  is_correct boolean,
  feedback text,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index exercises_user_id_idx on public.exercises (user_id);
create index exercises_session_id_idx on public.exercises (session_id);

alter table public.exercises enable row level security;

create policy "exercises_select_own" on public.exercises
  for select to authenticated using (user_id = (select auth.uid()));

create policy "exercises_insert_own" on public.exercises
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "exercises_update_own" on public.exercises
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "exercises_delete_own" on public.exercises
  for delete to authenticated using (user_id = (select auth.uid()));
