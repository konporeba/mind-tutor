---
change_id: domain-schema-rls-baseline
title: Domain schema + per-learner RLS baseline for the session loop
status: implementing
created: 2026-05-28
updated: 2026-05-28
archived_at: null
---

## Notes

Roadmap source: F-01 (`context/foundation/roadmap.md`), Stream A, status `ready`.

**Outcome:** migrate the minimum domain schema (sessions, materials, generated_content, exercises) with per-learner RLS policies, and document the RLS policy template that every downstream slice extends.

**PRD refs:** NFR (`visible only to the learner who owns them`), Access Control (flat user model — RLS keys off `auth.uid()`).

**Why first:** unlocks S-01 (north star, first grounded session) and every later slice that adds a table/column extends this RLS pattern instead of re-deriving it. Getting per-learner isolation wrong on the first table propagates to every subsequent table — foundationizing it now (with a documented pattern S-01 reuses) is cheaper than retrofitting once five tables exist.

**Prerequisites:** none. **Parallel with:** S-09 (auth extension, touches `auth.users` only).

**Baseline note:** `supabase/migrations/` exists but holds zero SQL files; no domain tables yet. Supabase client already wired at `src/lib/supabase.ts`.
