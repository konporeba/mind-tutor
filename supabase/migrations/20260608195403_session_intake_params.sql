-- Per-session intake params (S-02).
--
-- Adds the three FR-018 intake values to the session aggregate: knowledge level
-- for the uploaded material, the learner's goal for this sitting, and the time
-- budget. Values are session-scoped (not on the profile) per the PRD.
--
-- All columns are NULLABLE: sessions created before S-02 (the S-01 north-star
-- loop) carry no intake and must remain valid. Going forward the API always
-- supplies all three (validated server-side). No backfill.
--
-- No new RLS policies: these are columns on `sessions`, already covered by the
-- four-policy template from F-01 (per-learner select/insert/update/delete).

alter table public.sessions
  add column knowledge_level text
    check (knowledge_level in ('novice', 'beginner', 'intermediate', 'advanced', 'expert')),
  add column learning_goal text
    check (char_length(learning_goal) <= 280),
  add column time_budget_minutes smallint
    check (time_budget_minutes in (15, 30, 60));
