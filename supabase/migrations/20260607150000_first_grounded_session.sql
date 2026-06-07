-- First grounded session (roadmap S-01).
--
-- Additive to the F-01 baseline (20260528202720_domain_schema_rls_baseline.sql).
-- Two changes, no destructive edits to existing tables or policies:
--
--   1. materials.extracted_text — persists the text parsed in the browser so the
--      server can ground generation and validate citations without re-parsing the
--      original file (and so S-05 can reuse it later). Nullable; no backfill.
--
--   2. A PRIVATE Storage bucket `materials` for the original uploaded bytes
--      (F-01 deferred Storage to this slice via the materials.storage_path hook).
--      Objects are keyed by path `{user_id}/{session_id}/{filename}`; the
--      per-object policies isolate each learner to their own top-level folder,
--      mirroring the per-learner table RLS template in
--      docs/reference/rls-policy-template.md. storage.objects already has RLS
--      enabled by Supabase — this migration only adds the four owner policies.

-- ============================================================================
-- 1. materials.extracted_text
-- ============================================================================
alter table public.materials add column extracted_text text;

-- ============================================================================
-- 2. Private `materials` Storage bucket
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

-- Ownership by path: the first folder segment of the object name must equal the
-- learner's uid. `(select auth.uid())` is wrapped so Postgres caches the lookup
-- once per statement (same load-bearing detail as the table policies).
create policy "materials_objects_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "materials_objects_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "materials_objects_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "materials_objects_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
