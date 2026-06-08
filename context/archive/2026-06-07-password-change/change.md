---
change_id: password-change
title: Change account password with current-password confirmation
status: archived
created: 2026-06-07
updated: 2026-06-08
archived_at: 2026-06-08T17:36:23Z
---

## Notes

Roadmap source: S-09 (`context/foundation/roadmap.md`), Stream D (Auth hardening), status `ready`.

**Outcome:** a learner changes their password from the account view by providing the current password and a new one; the session continues (no forced logout) and the next login uses the new password.

**PRD refs:** FR-017 (must-have) — "A learner can change their password from the account view by providing the current password and a new one." Password reset via email is a Non-Goal.

**Prerequisites:** none. **Parallel with:** every other slice — extends the existing Supabase auth scaffold and touches no domain tables.

**Load-bearing risk (from roadmap):** Supabase rotates the session token on password change; the cookie/session must stay valid through the rotation so the learner is not forced to re-login. Workers `Set-Cookie` semantics make this subtler than it looks — verify on staging, not just `wrangler dev`.

**Baseline note:** auth scaffold present — `src/pages/api/auth/{signin,signup,signout}.ts`, `src/lib/supabase.ts` (`@supabase/ssr` cookie client), `src/middleware.ts` (`PROTECTED_ROUTES`), React auth islands in `src/components/auth/*`. No "account view" page exists yet — `dashboard.astro` is the only protected page.
