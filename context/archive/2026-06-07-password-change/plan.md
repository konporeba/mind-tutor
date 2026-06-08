# Password Change Implementation Plan

## Overview

Let a logged-in learner change their account password from a new `/account` view by providing their **current** password plus a new one (entered twice). The server verifies the current password before updating it, and the learner stays logged in — no forced re-login. This delivers roadmap slice S-09 (`password-change`) / PRD FR-017.

## Current State Analysis

The repo already has a complete, consistent Supabase auth scaffold; this slice extends it without introducing new infrastructure.

- **API routes** (`src/pages/api/auth/{signin,signup,signout}.ts`) all follow one shape: read `await context.request.formData()`, build a client via `createClient(context.request.headers, context.cookies)`, guard the `null` client with a redirect (`"Supabase is not configured"`), call a `supabase.auth.*` method, and `context.redirect(...?error=<encoded>)` on failure or to a destination on success. No zod in these routes today — they validate by trusting the form + Supabase's own errors.
- **Cookie/session plumbing** lives in `src/lib/supabase.ts` — `createServerClient` from `@supabase/ssr` with `getAll`/`setAll`. Any auth call that rotates tokens writes new cookies through `cookies.set` automatically.
- **Middleware** (`src/middleware.ts`) resolves `context.locals.user` via `getUser()` on every request and redirects unauthenticated hits to routes in `PROTECTED_ROUTES` (currently only `["/dashboard"]`) to `/auth/signin`.
- **UI pattern**: React island forms (e.g. `src/components/auth/SignInForm.tsx`) with `method="POST"` to the API route, `noValidate`, client-side `validate()` on submit, and the shared building blocks `FormField`, `PasswordToggle`, `SubmitButton`, `ServerError`. The host `.astro` page reads `Astro.url.searchParams.get("error")` and passes it as `serverError`.
- **No account view exists** — `src/pages/dashboard.astro` is the only protected page and hosts the sign-out form. There is no success-banner component (only `ServerError` for the error case).

### Key Discoveries:

- `src/pages/api/auth/signin.ts:13` — `signInWithPassword({ email, password })` is exactly the call we reuse to **verify** the current password.
- `src/lib/supabase.ts:22` — `setAll` writes rotated session cookies; this is what carries session continuity through a password change.
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard"]` must gain `/account`.
- `src/components/auth/FormField.tsx:8` — `FormField` already supports `error`, `endContent` (for `PasswordToggle`), and an icon; the new form composes three of these.
- `src/components/auth/ServerError.tsx` — the error-banner pattern to mirror for a new success banner.
- Supabase's `auth.updateUser({ password })` **does not** check the current password — verification is our responsibility (decided: server-side re-auth check).

## Desired End State

A learner who is signed in can visit `/account`, see a "Change password" form with three fields (current, new, confirm new), submit it, and:

- On success: land back on `/account` with a green success banner ("Password updated"), **still logged in**, and their next sign-in works only with the new password.
- On wrong current password: land back on `/account` with the existing red `ServerError` banner ("Current password is incorrect") and no change applied.
- Visiting `/account` while logged out redirects to `/auth/signin` (middleware).

Verify by: `npm run lint` + `npm run build` pass; and manual happy-path / wrong-password / session-continuity checks on a deployed Worker.

## What We're NOT Doing

- **Password reset / forgot-password via email** — explicit PRD Non-Goal; out of scope.
- **Revoking other active sessions / global sign-out** — not required by FR-017; session continuity for the current session is the only requirement.
- **A full account-settings surface** (email change, profile, bio) — `/account` is created here but only hosts the password form; S-08 (bio edit) will extend it later.
- **Introducing zod to the auth routes** — existing auth routes don't use it; we stay consistent rather than refactoring the convention in this slice.
- **Adding a test runner / unit-test harness** — no test infra exists today; testing strategy is a Module 3 concern. Verification is lint/build + manual-on-staging (chosen).
- **Rate limiting / brute-force protection on the verify step** — relies on Supabase's own protections for MVP.

## Implementation Approach

Mirror the existing auth scaffold exactly. One new API route does verify-then-update inside a single request so all cookie writes settle on the final rotated session. One new protected page hosts one new React island built from the shared `auth/*` primitives. The only genuinely non-obvious piece is the verify-then-update sequencing and its cookie behaviour — captured below.

## Critical Implementation Details

- **Timing & lifecycle (verify → update, single request):** The route must (1) verify the current password with `signInWithPassword`, then (2) call `updateUser({ password: newPassword })` — in that order, on a client wired to `context.cookies`. Both calls can rotate the session token; because they run in one request against the same cookie store, the **last** `setAll` write wins and leaves a valid session, so the learner stays logged in. Do not short-circuit by calling `updateUser` first — without the verify step there is no current-password check (Supabase ignores it). If verification fails, return the error redirect **before** calling `updateUser`.
- **Debug & observability:** The roadmap flags Workers `Set-Cookie` rotation as load-bearing and explicitly weaker under `wrangler dev` than staging. The session-continuity success criterion must be checked on a deployed Worker, confirming the user is still authenticated (`/dashboard` or `/account` loads without redirect) immediately after the change.

## Phase 1: Backend — change-password API route

### Overview

Add the server endpoint that verifies the current password and updates it, redirecting back to `/account` with a success or error signal.

### Changes Required:

#### 1. Change-password API route

**File**: `src/pages/api/auth/change-password.ts` (new)

**Intent**: Accept the change-password form POST, verify the current password via re-auth, reject on failure, otherwise update the password and signal success — all while keeping the session valid. Mirrors the structure of `signin.ts`/`signup.ts`.

**Contract**: `export const POST: APIRoute`. Reads `currentPassword`, `newPassword`, `confirmPassword` from `formData`. Resolves the current user's email from `context.locals.user` (populated by middleware) for the verify call. Behaviour, in order:

1. Build client via `createClient(headers, cookies)`; if `null` → redirect `/account?error=Supabase is not configured` (encoded), matching the existing guard.
2. If no authenticated user/email on `context.locals` → redirect `/auth/signin`.
3. Server-side guard rails (defense-in-depth behind the client validation): `newPassword` length ≥ 8, `newPassword === confirmPassword`, `newPassword !== currentPassword` → on any failure redirect `/account?error=<message>`.
4. Verify: `signInWithPassword({ email, password: currentPassword })`; on error → redirect `/account?error=Current password is incorrect`.
5. Update: `updateUser({ password: newPassword })`; on error → redirect `/account?error=<error.message>`.
6. Success → redirect `/account?success=Password updated`.
   All redirects use `encodeURIComponent` on the message, exactly as `signin.ts:16` does.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Production build passes: `npm run build`
- Route file exists at `src/pages/api/auth/change-password.ts` and exports `POST`

#### Manual Verification:

- POSTing valid current + new password returns a redirect to `/account?success=...`
- POSTing a wrong current password redirects to `/account?error=Current password is incorrect` and the password is unchanged (old password still logs in)
- POSTing mismatched new/confirm or a <8-char new password redirects with the corresponding `?error=...` and applies no change

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: Frontend — account view + change-password form

### Overview

Add the protected `/account` page, the React form island, a success banner, middleware protection, and a dashboard link so the feature is reachable end-to-end.

### Changes Required:

#### 1. Success banner component

**File**: `src/components/auth/SuccessBanner.tsx` (new)

**Intent**: Render a green success message when present, mirroring `ServerError`'s shape so the form has a counterpart for the success case.

**Contract**: `SuccessBanner({ message }: { message?: string | null })` returns `null` when no message, else a styled banner (green palette analogous to `ServerError`'s red one, e.g. `CircleCheck` icon from lucide-react).

#### 2. Change-password form island

**File**: `src/components/auth/ChangePasswordForm.tsx` (new)

**Intent**: Three-field password form posting to the new route, with client-side validation and the success/error banners — built from the existing `FormField` + `PasswordToggle` + `SubmitButton` + `ServerError` primitives, following `SignInForm.tsx`.

**Contract**: `ChangePasswordForm({ serverError, serverSuccess }: { serverError?: string | null; serverSuccess?: string | null })`. `method="POST" action="/api/auth/change-password"`, `noValidate`. Local state for `currentPassword`, `newPassword`, `confirmPassword`, per-field `showPassword` toggles, and an `errors` map. `validate()` enforces: all three required; `newPassword` ≥ 8 chars; `confirmPassword === newPassword`; `newPassword !== currentPassword`. `onSubmit` calls `e.preventDefault()` when invalid. Renders `ServerError` (from `serverError`) and `SuccessBanner` (from `serverSuccess`). Field `name` attributes must be `currentPassword` / `newPassword` / `confirmPassword` to match the route.

#### 3. Account page

**File**: `src/pages/account.astro` (new)

**Intent**: Host the change-password form in the same visual shell as the auth pages, reading the success/error query params and passing them to the island.

**Contract**: Reads `Astro.url.searchParams.get("error")` and `get("success")`; renders `<ChangePasswordForm serverError={error} serverSuccess={success} client:load />` inside the `Layout` + `bg-cosmic` card markup used by `signin.astro`/`dashboard.astro`. Includes a back link to `/dashboard`.

#### 4. Protect the account route

**File**: `src/middleware.ts`

**Intent**: Ensure `/account` is only reachable by authenticated users.

**Contract**: Add `"/account"` to `PROTECTED_ROUTES`.

#### 5. Link to account from dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Give the learner a way to reach the account view.

**Contract**: Add an `<a href="/account">` (styled like the existing dashboard button/links) near the sign-out form.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Production build passes: `npm run build`
- Files exist: `src/pages/account.astro`, `src/components/auth/ChangePasswordForm.tsx`, `src/components/auth/SuccessBanner.tsx`

#### Manual Verification:

- Visiting `/account` while logged out redirects to `/auth/signin`
- Visiting `/account` while logged in shows the three-field form
- Client-side validation blocks submit on empty fields, <8-char new password, mismatched confirm, or new == current (with inline field errors)
- Happy path: change succeeds → `/account` shows the green success banner, user is **still logged in** (navigating to `/dashboard` does not redirect to sign-in)
- Wrong current password → red `ServerError` banner, no change
- After a successful change, signing out and back in works only with the **new** password
- Session-continuity verified on a **deployed/staging Worker** (not just `wrangler dev`), per the roadmap's load-bearing cookie-rotation risk

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation from the human — especially the staging session-continuity check — before considering the slice done.

---

## Testing Strategy

No automated test harness exists in the repo and introducing one is out of scope (Module 3 concern). Verification rests on the lint/build gates plus disciplined manual checks.

### Manual Testing Steps:

1. Sign in, open `/dashboard`, click through to `/account`.
2. Submit with each invalid case (empty, short, mismatched, same-as-current) → confirm inline errors, no navigation.
3. Submit a valid change → confirm success banner and that you remain logged in (load `/dashboard` without redirect).
4. Submit with a wrong current password → confirm `ServerError`, no change.
5. Sign out, attempt sign-in with the OLD password → fails; sign in with the NEW password → succeeds.
6. Repeat step 3 on a deployed Worker to confirm `Set-Cookie` rotation keeps the session alive on Workers runtime.
7. Log out, hit `/account` directly → confirm redirect to `/auth/signin`.

## Performance Considerations

Negligible — two Supabase auth calls per change, on a rare user action. No hot path.

## Migration Notes

None — no schema or data changes; operates on `auth.users` via Supabase Auth only.

## References

- Roadmap slice: `context/foundation/roadmap.md` → S-09 (`password-change`)
- PRD: FR-017 (`context/foundation/prd.md:98`)
- Pattern to mirror (route): `src/pages/api/auth/signin.ts`
- Pattern to mirror (form): `src/components/auth/SignInForm.tsx`
- Cookie/session client: `src/lib/supabase.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — change-password API route

#### Automated

- [x] 1.1 Linting passes: `npm run lint`
- [x] 1.2 Production build passes: `npm run build`
- [x] 1.3 Route file exists at `src/pages/api/auth/change-password.ts` and exports `POST`

#### Manual

- [ ] 1.4 Valid current + new password redirects to `/account?success=...`
- [ ] 1.5 Wrong current password redirects to `/account?error=Current password is incorrect`, password unchanged
- [ ] 1.6 Mismatched/short new password redirects with the corresponding `?error=...`, no change

### Phase 2: Frontend — account view + change-password form

#### Automated

- [x] 2.1 Linting passes: `npm run lint`
- [x] 2.2 Production build passes: `npm run build`
- [x] 2.3 Files exist: `account.astro`, `ChangePasswordForm.tsx`, `SuccessBanner.tsx`

#### Manual

- [ ] 2.4 `/account` while logged out redirects to `/auth/signin`
- [ ] 2.5 `/account` while logged in shows the three-field form
- [ ] 2.6 Client-side validation blocks empty / <8-char / mismatched / same-as-current with inline errors
- [ ] 2.7 Happy path: success banner shown and user stays logged in
- [ ] 2.8 Wrong current password: ServerError banner, no change
- [ ] 2.9 After change, only the new password logs in
- [ ] 2.10 Session-continuity verified on a deployed/staging Worker
