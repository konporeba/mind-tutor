# Password Change — Plan Brief

> Full plan: `context/changes/password-change/plan.md`

## What & Why

Let a logged-in learner change their account password by providing their current password and a new one (PRD FR-017, roadmap S-09). This is routine auth hardening — the one rotation case the MVP supports (email-based password reset is a Non-Goal).

## Starting Point

The repo already has a complete Supabase auth scaffold: `signin`/`signup`/`signout` API routes (formData → `supabase.auth.*` → redirect with `?error=`), a `@supabase/ssr` cookie client (`src/lib/supabase.ts`), middleware that protects routes and resolves `locals.user`, and React auth-form islands built from shared `FormField`/`PasswordToggle`/`ServerError`/`SubmitButton` primitives. There is **no account view yet** — `dashboard.astro` is the only protected page.

## Desired End State

A learner opens a new protected `/account` page, fills in current + new + confirm passwords, and submits. On success they see a green banner and **stay logged in**; their next sign-in requires the new password. A wrong current password shows the existing red error banner and changes nothing.

## Key Decisions Made

| Decision           | Choice                                                          | Why (1 sentence)                                                                              | Source |
| ------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ |
| Where the UI lives | New `/account` page                                             | Matches the roadmap's "account view" wording and gives S-08 (bio edit) a home later.          | Plan   |
| Current-pwd verify | Server-side re-auth (`signInWithPassword`) then `updateUser`    | Supabase's `updateUser` ignores the current password, so we must verify it ourselves.         | Plan   |
| Password rules     | ≥8 chars + confirm field + must differ from current             | Sensible baseline above Supabase's min-6; confirm prevents typo lockout.                      | Plan   |
| Success/error UX   | Stay logged in; redirect to `/account` with `?success`/`?error` | Reuses the established `ServerError` + searchParams convention; satisfies "no forced logout". | Plan   |
| Testing            | Lint/build gates + manual-on-staging                            | No test harness exists today; the real cookie-rotation risk only manifests on a real Worker.  | Plan   |

## Scope

**In scope:** `/account` page; `change-password` API route (verify → update); `ChangePasswordForm` island + `SuccessBanner`; middleware protection; dashboard link.

**Out of scope:** email/forgot-password reset; revoking other sessions; broader account settings (email/bio); a test runner; rate limiting; adding zod to auth routes.

## Architecture / Approach

`ChangePasswordForm` (React island) POSTs to `POST /api/auth/change-password`. The route, in one request: verifies the current password via `signInWithPassword`, then calls `updateUser({ password })`. Both calls run against the same cookie store so the final rotated session cookie wins and the learner stays authenticated. The page reads `?success`/`?error` from the URL and renders the matching banner — identical to how `signin.astro` surfaces errors today.

## Phases at a Glance

| Phase                    | What it delivers                                 | Key risk                                                                 |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------ |
| 1. Backend route         | `change-password` route: verify → update         | Verify-then-update ordering; session token rotation through cookies      |
| 2. Frontend account view | `/account` page, form island, banner, middleware | `Set-Cookie` rotation must keep the session alive on the Workers runtime |

**Prerequisites:** none — extends existing auth scaffold, touches no domain tables.
**Estimated effort:** ~1 session across 2 phases (≈5 small files, all mirroring existing patterns).

## Open Risks & Assumptions

- **Session continuity through token rotation** is the one load-bearing risk; the roadmap flags Workers `Set-Cookie` semantics as subtler than `wrangler dev` shows — must be verified on staging.
- Assumes the Supabase project's minimum password length is ≤8 (so the ≥8 client rule doesn't collide with a stricter backend rule unexpectedly).

## Success Criteria (Summary)

- A learner changes their password with the correct current password and remains logged in.
- A wrong current password is rejected with a clear error and no change.
- After a successful change, only the new password logs in — verified on a deployed Worker.
