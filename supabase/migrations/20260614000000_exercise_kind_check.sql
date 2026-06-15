-- Constrain exercises.kind to the known exercise types (roadmap S-04).
--
-- S-04 introduces fill-in-the-blank and matching exercises alongside the original
-- MCQ. `exercises.kind` was previously an unconstrained `text default 'mcq'`; this
-- adds a CHECK mirroring the `generated_content.kind` convention from F-01, so a
-- bad kind is rejected at the database, not just the app layer.
--
-- Existing rows are all 'mcq' (S-01 only ever wrote MCQs), so the constraint
-- validates cleanly with no data backfill.

alter table public.exercises
  add constraint exercises_kind_check check (kind in ('mcq', 'fill_blank', 'matching'));
