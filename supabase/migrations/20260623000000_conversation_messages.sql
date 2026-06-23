-- conversation_messages — persisted ask-the-tutor Q&A turns (S-05, FR-008).
--
-- One row per chat turn within a session: a learner question (role 'user') or a
-- grounded tutor answer (role 'assistant'), ordered by `position`. Append-only —
-- turns are never edited, so there is no updated_at column or trigger (matching
-- generated_content / exercises). Persisting turns is what lets S-06 (session
-- history) replay the conversation later.
--
-- Ownership + RLS follow the F-01 per-learner template verbatim
-- (docs/reference/rls-policy-template.md): a denormalized `user_id` and the
-- four-policy block keyed on `user_id = (select auth.uid())` for the
-- `authenticated` role. Cascade on session_id is what S-07 (delete session)
-- relies on for cleanup; cascade on user_id removes turns on account deletion.

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  position int not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index conversation_messages_user_id_idx on public.conversation_messages (user_id);
create index conversation_messages_session_id_idx on public.conversation_messages (session_id);

alter table public.conversation_messages enable row level security;

create policy "conversation_messages_select_own" on public.conversation_messages
  for select to authenticated using (user_id = (select auth.uid()));

create policy "conversation_messages_insert_own" on public.conversation_messages
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "conversation_messages_update_own" on public.conversation_messages
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "conversation_messages_delete_own" on public.conversation_messages
  for delete to authenticated using (user_id = (select auth.uid()));
