-- Maintain sessions.updated_at on every UPDATE.
-- The baseline migration defaults updated_at to now() on insert but does not
-- refresh it on update, so it would silently go stale. moddatetime is the
-- Supabase-provided helper for this; keep it in the extensions schema.

create extension if not exists moddatetime schema extensions;

create trigger sessions_set_updated_at
  before update on public.sessions
  for each row
  execute function extensions.moddatetime(updated_at);
