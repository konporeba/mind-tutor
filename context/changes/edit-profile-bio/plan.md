# Edit Profile Bio Implementation Plan

## Overview

Let an already-onboarded learner edit their stored profile bio after onboarding. The bio (`profiles.bio`, free text, `BIO_MAX = 1000`) is captured once during onboarding by distilling scripted answers through an LLM and is then reused on every session to set tutoring depth/idiom (FR-006). Today there is no surface to view or change it. This plan adds an edit form to the existing `/account` page and a form-POST endpoint that saves the user's raw edited text.

## Current State Analysis

- **Data model already exists.** `supabase/migrations/20260609100000_profiles_bio.sql` defines `public.profiles` with `user_id` (PK → `auth.users`), `bio text` (nullable), `onboarded_at`, `created_at`, `updated_at`, plus a `moddatetime` trigger on `updated_at`. **No migration is needed.**
- **RLS already permits self-update.** The migration ships the four-policy block including `profiles_update_own` (`for update to authenticated using (user_id = (select auth.uid())) with check (...)`). No policy change is needed.
- **Bio is currently written once, at onboarding.** `src/pages/api/onboarding/index.ts:55` calls `distillBio(answers)` then `upsert`s `{ user_id, bio, onboarded_at }`. There is no post-onboarding read or write path for the bio.
- **The account page is the natural home and is sparse today.** `src/pages/account.astro` is a protected route (`PROTECTED_ROUTES` in `src/middleware.ts:4`) that renders only `ChangePasswordForm` inside a single `max-w-sm` card, reading `?error=` / `?success=` query params.
- **A directly reusable feature pattern exists.** `ChangePasswordForm.tsx` (React island: local state, client validation, `FormField`/`SubmitButton`/`ServerError`/`SuccessBanner`) + `src/pages/api/auth/change-password.ts` (form-POST → server validation → Supabase op → `context.redirect("/account?success=...")`). The bio feature mirrors this end-to-end.
- **Types and caps are defined.** `src/types.ts:58` exports `BIO_MAX = 1000`; `Profile`/`ProfileUpdate` types are exported (`src/types.ts:35-37`).
- **No shadcn `Textarea`.** A raw styled `<textarea>` precedent exists in `OnboardingChat.tsx` (rows, `maxLength`, glassmorphism classes).

## Desired End State

An onboarded learner visits `/account` and sees two cards: "Your bio" (textarea pre-filled with their current bio + a live character counter) and the existing "Change password" card. Editing the bio text and submitting saves the raw trimmed text to `profiles.bio`, reloads `/account`, and shows a success banner on the bio card only. A blank/whitespace-only submission is rejected with an inline error and does not clear the stored bio. The 1000-char cap is enforced client-side (textarea `maxLength`) and server-side (defense-in-depth).

Verification: `npm run lint` and `npm run build` pass; manually, the round-trip persists the edit, blank is rejected, and the password card's banners are unaffected by a bio save (and vice-versa).

### Key Discoveries:

- `profiles.bio` + `profiles_update_own` RLS already exist — no DB work (`supabase/migrations/20260609100000_profiles_bio.sql:16-38`).
- Mirror `change-password.ts` exactly for the endpoint shape (`src/pages/api/auth/change-password.ts:10-57`) and `ChangePasswordForm.tsx` for the island.
- The account page shares one `?error=`/`?success=` namespace across cards — the bio form must use **distinct** param names (`bioError`/`bioSuccess`) so a bio save does not light up the password banner. Password form keeps its existing `error`/`success` untouched.
- `account.astro` must server-fetch the current bio to pre-fill the textarea (it currently fetches nothing).

## What We're NOT Doing

- No re-distillation: edited text is saved raw, not re-run through `distillBio`.
- No ability to clear the bio to empty/null (min 1 char after trim is required).
- No schema migration, no RLS change, no new `profiles` columns.
- No automated test (E2E/endpoint) — consistent with how the surrounding account features ship.
- No shadcn `Textarea`/`Label` install — a raw styled `<textarea>` is used.
- No change to the onboarding write path or the middleware onboarding gate.
- No separate `/account/bio` route or nav restructuring.

## Implementation Approach

Two thin phases, each independently verifiable. Phase 1 adds the backend endpoint (testable via the network/redirect even before the UI exists). Phase 2 wires the account page to read the current bio and render the editor island. The whole feature is a near-copy of the existing password-change feature with a different field and namespaced status params.

## Critical Implementation Details

- **Shared query-param namespace.** `account.astro` reads four params after this change: `error`/`success` (password, unchanged) and `bioError`/`bioSuccess` (new). Each card receives only its own pair. Without distinct names, saving the bio would render a green banner on the password card. This is the one non-obvious coupling on the page.

## Phase 1: Bio update API endpoint

### Overview

Add `POST /api/profiles/bio` that authenticates the caller, validates the submitted bio, updates the caller's `profiles.bio`, and redirects back to `/account` with a namespaced status param.

### Changes Required:

#### 1. Bio update endpoint

**File**: `src/pages/api/profiles/bio.ts` (new)

**Intent**: Accept a form-POST bio edit, validate it server-side (defense-in-depth behind the client), persist it to the caller's profile row, and redirect to `/account` with `bioSuccess`/`bioError`. Mirror the structure and helpers of `change-password.ts`.

**Contract**:
- `export const prerender = false;` and `export const POST: APIRoute`.
- Read `bio` from `await context.request.formData()`.
- Get `createClient(context.request.headers, context.cookies)`; if null → redirect `/account?bioError=...` ("Supabase is not configured").
- Require `context.locals.user`; if absent → `context.redirect("/auth/signin")`.
- Validate with zod: `z.string().trim().min(1).max(BIO_MAX)` (import `BIO_MAX` from `@/types`). On failure → `/account?bioError=...` with a friendly message ("Your bio can't be empty." / "Your bio is too long.").
- Update only the bio: `supabase.from("profiles").update({ bio: parsed }).eq("user_id", user.id)`. Use `update` (not `upsert`) — the row is guaranteed to exist post-onboarding, and RLS `profiles_update_own` covers it. On error → `/account?bioError=...`.
- Success → `context.redirect(\`/account?bioSuccess=\${encodeURIComponent("Bio updated")}\`)`.
- A local `fail(context, message)` helper mirroring `change-password.ts:6-8` but pointing at `bioError`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (Astro `astro check`-equivalent SSR build compiles the new route)
- Linting passes: `npm run lint`

#### Manual Verification:

- POSTing a valid bio (via the form in Phase 2, or curl with session cookies) updates `profiles.bio` and redirects to `/account?bioSuccess=...`.
- POSTing a blank/whitespace bio redirects to `/account?bioError=...` and leaves the stored bio unchanged.
- POSTing while signed out redirects to `/auth/signin`.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Account page bio card + form

### Overview

Server-fetch the current bio in `account.astro`, restructure the page to hold two cards, and add an `EditBioForm` React island that edits and submits the bio.

### Changes Required:

#### 1. Bio editor island

**File**: `src/components/account/EditBioForm.tsx` (new)

**Intent**: A controlled textarea pre-filled with the current bio, with a live character counter and client-side validation, submitting via form-POST to `/api/profiles/bio`. Mirror `ChangePasswordForm.tsx`'s structure (local state, `clearError`, `handleSubmit` that calls `e.preventDefault()` on invalid) and reuse `SubmitButton`/`ServerError`/`SuccessBanner`.

**Contract**:
- Props: `{ initialBio: string; serverError?: string | null; serverSuccess?: string | null }`.
- `<form method="POST" action="/api/profiles/bio" noValidate>` with a single `name="bio"` `<textarea>` (controlled), styled like the `OnboardingChat.tsx` textarea, `maxLength={BIO_MAX}` (import from `@/types`).
- Live counter `{value.length}/{BIO_MAX}`.
- Client validation: reject empty-after-trim with an inline error (block submit via `e.preventDefault()`); mirror the `FieldErrors` pattern.
- Render `<ServerError message={serverError} />`, `<SuccessBanner message={serverSuccess} />`, and `<SubmitButton pendingText="Saving...">Save bio</SubmitButton>`.

#### 2. Account page restructure + bio fetch

**File**: `src/pages/account.astro`

**Intent**: Fetch the caller's current bio server-side, retitle the page to "Account", widen the container to hold two stacked cards, and render `EditBioForm` (bio card) above the existing password card. Route the namespaced params to the correct card.

**Contract**:
- Read four params: `error`/`success` (existing, → password card) and `bioError`/`bioSuccess` (new, → bio card).
- Server-fetch the bio: `createClient(...)` then `supabase.from("profiles").select("bio").eq("user_id", Astro.locals.user.id).maybeSingle()`; pass `data?.bio ?? ""` as `initialBio`. (User is guaranteed present + onboarded by middleware.)
- Page heading text → "Account"; widen the outer container from `max-w-sm` to accommodate two cards (e.g. `max-w-md`/`max-w-lg`), each card keeping the existing glassmorphism styling. Each form sits in its own card with its own heading ("Your bio", "Change password").
- Render `<EditBioForm initialBio={...} serverError={bioError} serverSuccess={bioSuccess} client:load />` and keep `<ChangePasswordForm serverError={error} serverSuccess={success} client:load />`.
- Keep the "Back to dashboard" link.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- `/account` shows the bio textarea pre-filled with the current stored bio and a working character counter.
- Editing the bio and clicking "Save bio" persists the change (visible after reload) and shows the success banner on the bio card only — the password card shows no banner.
- Submitting a blank bio shows an inline/`ServerError` message and does not overwrite the stored bio.
- Changing the password still works and its banner appears on the password card only (no regression).
- The 1000-char cap is enforced (textarea stops accepting input at the limit).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- None added (consistent with the surrounding account features, which ship without dedicated tests).

### Integration Tests:

- None added.

### Manual Testing Steps:

1. Sign in as an onboarded user, go to `/account`; confirm the bio textarea is pre-filled with the stored bio.
2. Edit the text, click "Save bio"; confirm redirect, persisted value after reload, and a success banner on the bio card only.
3. Clear the textarea and submit; confirm rejection (inline error or `bioError` banner) and that the stored bio is unchanged.
4. Type up to/over 1000 chars; confirm the cap is enforced.
5. Change the password; confirm its banner shows on the password card only — the bio card is unaffected.
6. Sign out and POST to `/api/profiles/bio`; confirm redirect to `/auth/signin`.

## Performance Considerations

Negligible. The account page gains one indexed-by-PK `profiles` select; the endpoint does one PK-scoped update. No LLM call (raw save), unlike the onboarding path.

## Migration Notes

None — no schema or data migration. The `profiles` row and `bio` column already exist for every onboarded user.

## References

- Endpoint pattern: `src/pages/api/auth/change-password.ts:10-57`
- Island pattern: `src/components/auth/ChangePasswordForm.tsx:22-138`
- Account page: `src/pages/account.astro`
- Textarea precedent: `src/components/onboarding/OnboardingChat.tsx:99-115`
- Schema + RLS: `supabase/migrations/20260609100000_profiles_bio.sql:16-38`
- Bio cap/type: `src/types.ts:35-37,58`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bio update API endpoint

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — 002ce3b
- [x] 1.2 Linting passes: `npm run lint` — 002ce3b

#### Manual

- [x] 1.3 Valid bio POST updates `profiles.bio` and redirects to `/account?bioSuccess=...`
- [x] 1.4 Blank/whitespace bio POST redirects to `/account?bioError=...` and leaves stored bio unchanged
- [x] 1.5 POST while signed out redirects to `/auth/signin`

### Phase 2: Account page bio card + form

#### Automated

- [x] 2.1 Type checking passes: `npm run build`
- [x] 2.2 Linting passes: `npm run lint`

#### Manual

- [x] 2.3 `/account` shows the bio textarea pre-filled with the stored bio and a working character counter
- [x] 2.4 Editing + "Save bio" persists the change and shows the success banner on the bio card only
- [x] 2.5 Blank submission shows an error and does not overwrite the stored bio
- [x] 2.6 Password change still works, banner on the password card only (no regression)
- [x] 2.7 The 1000-char cap is enforced in the textarea
