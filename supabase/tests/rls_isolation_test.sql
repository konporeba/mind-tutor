-- Per-learner RLS isolation test (roadmap F-01, plan Phase 2).
--
-- Proves that an authenticated learner (A) cannot SELECT, UPDATE, or DELETE
-- another learner's (B) rows in any of the four domain tables, and that the
-- `anon` role sees nothing. This is the executable proof behind the RLS
-- template documented in docs/reference/rls-policy-template.md.
--
-- Run with: npx supabase test db
--
-- Mechanics:
--   * Seed runs as the postgres superuser, which bypasses RLS.
--   * Impersonation = `set local role authenticated` + a JWT `sub` claim, which
--     is what auth.uid() reads. `reset role` returns to the superuser so the
--     no-op writes can be verified from an unfiltered vantage point.
--   * Write denial is proven by EFFECT (the row is unchanged / still present),
--     not by absence of error — RLS makes a filtered UPDATE/DELETE a silent
--     0-row no-op, so "no error" alone would be a false pass.

begin;
create extension if not exists pgtap;
select plan(29);

-- ============================================================================
-- Seed two learners and one owned row per table for each (as superuser).
-- ============================================================================
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local');

insert into public.sessions (id, user_id, status) values
  ('11111111-1111-1111-1111-11111111111a', '00000000-0000-0000-0000-00000000000a', 'active'),
  ('11111111-1111-1111-1111-11111111111b', '00000000-0000-0000-0000-00000000000b', 'active');

insert into public.materials (id, user_id, session_id, filename, mime_type, size_bytes) values
  ('22222222-2222-2222-2222-22222222222a', '00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-11111111111a', 'a.pdf', 'application/pdf', 1),
  ('22222222-2222-2222-2222-22222222222b', '00000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-11111111111b', 'b.pdf', 'application/pdf', 1);

insert into public.generated_content (id, user_id, session_id, kind, position) values
  ('33333333-3333-3333-3333-33333333333a', '00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-11111111111a', 'theory', 0),
  ('33333333-3333-3333-3333-33333333333b', '00000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-11111111111b', 'theory', 0);

insert into public.exercises (id, user_id, session_id, position, prompt) values
  ('44444444-4444-4444-4444-44444444444a', '00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-11111111111a', 0, 'qa'),
  ('44444444-4444-4444-4444-44444444444b', '00000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-11111111111b', 0, 'qb');

-- New column (S-01): seed a private extracted_text on A's material only, to prove
-- it is reachable only under the existing materials_*_own policies.
update public.materials
  set extracted_text = 'secret-a-text'
  where id = '22222222-2222-2222-2222-22222222222a';

-- Storage objects (S-01): one owned object per learner under their own uid prefix
-- in the private `materials` bucket. Path convention: {user_id}/{session_id}/{file}.
insert into storage.objects (bucket_id, name, owner_id) values
  ('materials', '00000000-0000-0000-0000-00000000000a/11111111-1111-1111-1111-11111111111a/a.pdf', '00000000-0000-0000-0000-00000000000a'),
  ('materials', '00000000-0000-0000-0000-00000000000b/11111111-1111-1111-1111-11111111111b/b.pdf', '00000000-0000-0000-0000-00000000000b');

-- ============================================================================
-- Impersonate learner A.
-- ============================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';

-- SELECT isolation: A sees exactly its own row and never B's.
select is((select count(*) from public.sessions)::int, 1, 'A sees only its own session');
select is((select count(*) from public.sessions where id = '11111111-1111-1111-1111-11111111111b')::int, 0, 'A cannot see B session');

select is((select count(*) from public.materials)::int, 1, 'A sees only its own material');
select is((select count(*) from public.materials where id = '22222222-2222-2222-2222-22222222222b')::int, 0, 'A cannot see B material');

select is((select count(*) from public.generated_content)::int, 1, 'A sees only its own generated_content');
select is((select count(*) from public.generated_content where id = '33333333-3333-3333-3333-33333333333b')::int, 0, 'A cannot see B generated_content');

select is((select count(*) from public.exercises)::int, 1, 'A sees only its own exercise');
select is((select count(*) from public.exercises where id = '44444444-4444-4444-4444-44444444444b')::int, 0, 'A cannot see B exercise');

-- Column isolation: A reads its own material's extracted_text, never B's.
select is((select extracted_text from public.materials where id = '22222222-2222-2222-2222-22222222222a'), 'secret-a-text', 'A reads its own extracted_text');
select is((select extracted_text from public.materials where id = '22222222-2222-2222-2222-22222222222b'), null::text, 'A cannot read B extracted_text');

-- Storage isolation: A sees only objects under its own uid prefix, never B's.
select is((select count(*) from storage.objects where bucket_id = 'materials')::int, 1, 'A sees only its own material object');
select is((select count(*) from storage.objects where name like '00000000-0000-0000-0000-00000000000b/%')::int, 0, 'A cannot see B material object');

-- Write attempts by A against B's rows. Under RLS these are silent 0-row no-ops.
update public.sessions          set title    = 'hacked' where id = '11111111-1111-1111-1111-11111111111b';
delete from public.sessions                              where id = '11111111-1111-1111-1111-11111111111b';
update public.materials         set filename = 'hacked' where id = '22222222-2222-2222-2222-22222222222b';
delete from public.materials                             where id = '22222222-2222-2222-2222-22222222222b';
update public.generated_content set position = 999      where id = '33333333-3333-3333-3333-33333333333b';
delete from public.generated_content                     where id = '33333333-3333-3333-3333-33333333333b';
update public.exercises         set prompt   = 'hacked' where id = '44444444-4444-4444-4444-44444444444b';
delete from public.exercises                             where id = '44444444-4444-4444-4444-44444444444b';
update storage.objects set name = 'hacked' where name like '00000000-0000-0000-0000-00000000000b/%';
delete from storage.objects                where name like '00000000-0000-0000-0000-00000000000b/%';

-- ============================================================================
-- Back to superuser: prove B's rows survived A's writes unchanged.
-- ============================================================================
reset role;

select is((select count(*) from public.sessions where id = '11111111-1111-1111-1111-11111111111b')::int, 1, 'B session not deleted by A');
select is((select title from public.sessions where id = '11111111-1111-1111-1111-11111111111b'), null::text, 'B session not updated by A');

select is((select count(*) from public.materials where id = '22222222-2222-2222-2222-22222222222b')::int, 1, 'B material not deleted by A');
select is((select filename from public.materials where id = '22222222-2222-2222-2222-22222222222b'), 'b.pdf', 'B material not updated by A');

select is((select count(*) from public.generated_content where id = '33333333-3333-3333-3333-33333333333b')::int, 1, 'B generated_content not deleted by A');
select is((select position from public.generated_content where id = '33333333-3333-3333-3333-33333333333b')::int, 0, 'B generated_content not updated by A');

select is((select count(*) from public.exercises where id = '44444444-4444-4444-4444-44444444444b')::int, 1, 'B exercise not deleted by A');
select is((select prompt from public.exercises where id = '44444444-4444-4444-4444-44444444444b'), 'qb', 'B exercise not updated by A');

select is((select count(*) from storage.objects where name = '00000000-0000-0000-0000-00000000000b/11111111-1111-1111-1111-11111111111b/b.pdf')::int, 1, 'B material object not deleted/renamed by A');

-- ============================================================================
-- The anon role has table grants but no policies grant it rows: default-deny.
-- ============================================================================
set local role anon;

select is((select count(*) from public.sessions)::int, 0, 'anon sees no sessions');
select is((select count(*) from public.materials)::int, 0, 'anon sees no materials');
select is((select count(*) from public.generated_content)::int, 0, 'anon sees no generated_content');
select is((select count(*) from public.exercises)::int, 0, 'anon sees no exercises');
select is((select count(*) from storage.objects where bucket_id = 'materials')::int, 0, 'anon sees no material objects');

-- anon write denial (sessions as representative; the mechanism is role-based and
-- identical across the four tables). INSERT is rejected outright (SQLSTATE 42501,
-- covers both RLS WITH CHECK and a missing grant); UPDATE/DELETE are silent
-- 0-row no-ops, proven by effect from the superuser vantage point below.
select throws_ok(
  $$ insert into public.sessions (user_id, status)
     values ('00000000-0000-0000-0000-00000000000a', 'active') $$,
  '42501',
  null,
  'anon cannot insert a session'
);

update public.sessions set title = 'anon-edit' where id = '11111111-1111-1111-1111-11111111111a';
delete from public.sessions                     where id = '11111111-1111-1111-1111-11111111111a';

reset role;

select is((select count(*) from public.sessions where id = '11111111-1111-1111-1111-11111111111a')::int, 1, 'anon did not delete A session');
select is((select title from public.sessions where id = '11111111-1111-1111-1111-11111111111a'), null::text, 'anon did not update A session');

select * from finish();
rollback;
