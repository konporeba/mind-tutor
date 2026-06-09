# Onboarding Bio Tailoring (S-03) Implementation Plan

## Overview

The first time a learner signs in, a **bounded guided-chat onboarding** (2–3 scripted tutor turns) captures their background. One LLM call distills the answers into a **single free-text bio**, which is persisted on a new `profiles` row. From then on, every session generation loads that bio and injects it into the prompt as **long-term framing (idiom + default depth)** — combining with the per-session intake (S-02) without changing the deterministic theory/MCQ counts. The onboarding is enforced by a **middleware gate** that redirects not-yet-onboarded users to `/onboarding`. Correctness is proven by extending the existing Vitest harness to assert the bio measurably appears in the built prompt.

This is FR-005 plus the **bio half of FR-006** (S-02 shipped the per-session half). With this slice, both halves of FR-006 are wired. The S-02 generation signature was deliberately shaped to accept bio later without reshaping it.

## Current State Analysis

S-01 (session loop) and S-02 (per-session intake) are live in production. Today:

- **No `profiles` table exists.** F-01's baseline explicitly notes "Missing: profile.bio column (covered by S-03)." The four existing domain tables (`sessions`, `materials`, `generated_content`, `exercises`) all carry the F-01 four-policy RLS template keyed off `user_id = (select auth.uid())` (`supabase/migrations/20260528202720_domain_schema_rls_baseline.sql`).
- **Auth flow:** signup → `/auth/confirm-email`; signin → redirect to `/` (`src/pages/api/auth/{signup,signin}.ts`). `src/middleware.ts` resolves `context.locals.user` on every request and redirects unauthenticated users away from `PROTECTED_ROUTES = ["/dashboard", "/account", "/sessions"]`.
- **Generation** (`src/lib/services/generation/generate.ts:75`): `generateSession(sourceText, intake)` computes `sizeFromIntake(intake)` once before a retry loop, builds the prompt via the **pure** `buildMessages(source, intake, sizing)` (`generate.ts:30`), and validates against `makeGeneratedSessionSchema(sizing)`. Source-grounding (verbatim citation check) is authoritative and unchanged by tailoring.
- **Sizing** (`src/lib/services/generation/sizing.ts`): `sizeFromIntake` maps time budget → counts and knowledge level → `depthGuidance`. Pure, unit-tested, monotonic.
- **Session creation** (`src/pages/api/sessions/index.ts`): POST validates upload + intake, calls `generateSession(extractedText, intake)` **before** any DB write, then persists session/material/theory/exercises with cleanup-on-failure. Intake arrives in the `FormData`; **the profile bio is not part of this request — it must be loaded server-side by `user_id`.**
- **LLM client** (`src/lib/services/generation/openrouter.ts`): provider-agnostic OpenAI-compatible client (`getOpenRouterClient`, `getModel`); `GenerationError`. The only LLM usage today is **one-shot structured JSON** — there is no multi-turn chat pattern in the codebase.
- **Shared types** (`src/types.ts`): domain row types + the S-02 `SessionIntake` shape and its constants.
- **Vitest harness** exists (added in S-02): `src/lib/services/generation/{sizing,generate}.test.ts`, `vitest.config.ts`, `npm run test`, and a CI test step in `.github/workflows/ci.yml`.

### Key Discoveries:

- `buildMessages(sourceText, intake, sizing)` (`generate.ts:30`) is **pure** and already exported for testing — the natural injection point for a conditional bio block and the place the Phase 5 test asserts against.
- `generateSession` builds `messages` **once** before the retry loop (`generate.ts:90`). Bio must be resolved before that point, exactly like sizing — bio in → prompt out, computed once.
- The API route generates **before** any DB write (`index.ts:88`). Loading the bio is a single read that slots in just before the `generateSession` call; a missing/null bio is a valid state (historical sessions, skipped onboards).
- F-01's RLS template (`docs/reference/rls-policy-template.md`) is copied verbatim by every table. `profiles` differs in one way only: its primary key **is** `user_id` (one row per learner), so the policy predicate is `user_id = (select auth.uid())` and there is no separate `id` column.
- Lesson `context/foundation/lessons.md` — "Lazy-import browser-only libraries in SSR'd islands." The `OnboardingChat` island uses only plain form controls + `fetch`; no browser-only library is introduced, so the lesson is satisfied by default.
- The middleware already does one `supabase.auth.getUser()` per request; adding the onboarding check means **one additional cheap read** on authenticated requests (acceptable at MVP's low QPS — see Performance Considerations).

## Desired End State

A learner who has just confirmed their email and signed in for the first time is redirected to `/onboarding`, where the tutor asks 2–3 short questions about their role, experience, and domains. On submit, their answers are distilled into a free-text bio, stored on their `profiles` row with `onboarded_at` set, and they land on the dashboard. Every session they start thereafter generates theory and exercises whose **idiom and default depth reflect the bio** (e.g. a "senior backend engineer" bio yields more idiomatic, less hand-holding prose than a "first-year student" bio on the same material and same intake), while the **number** of steps/MCQs still tracks the per-session time budget. Returning (already-onboarded) learners are never gated. Historical S-01/S-02 sessions and any null-bio learner generate exactly as before.

**Verification:** `npm run test` (extended) passes; `npm run build`, `npm run lint`, `npx supabase test db` stay green; manual walkthrough shows a forced first-run onboarding, a persisted bio row, and visibly different prose framing for two different bios on the same source + intake; a learner who has onboarded is not re-gated.

## What We're NOT Doing

- **No bio editing or re-onboarding surface.** Revising an existing bio is **S-08** (`edit-profile-bio`), explicitly out of scope. The only "re-run" here is the natural consequence of the gate: a learner who has *not* completed onboarding (null bio) is re-prompted on next sign-in.
- **No structured bio fields** (role/years/domains as columns). Single free-text `bio` per PRD FR-005.
- **No bio effect on sizing/counts.** Bio is prompt-framing only; the deterministic theory/MCQ counts stay intake-driven (`sizing.ts` unchanged). Bio does not override or arbitrate the per-session knowledge level.
- **No full open-ended conversational agent.** The chat is a bounded, scripted 2–3-turn flow with one distill call — not an adaptive multi-turn interview.
- **No change to S-01 grounding/citation** mechanics.
- **No backfill** of bios onto existing learners — they hit the gate on their next sign-in and onboard then; their historical sessions are untouched.
- **No `auth.users` trigger.** The `profiles` row is created lazily (upsert) at onboarding completion, avoiding a security-definer trigger on the auth schema.

## Implementation Approach

Build bottom-up so each phase rests on a committed contract, mirroring the proven S-02 shape: schema + types first, then generation consumes the new input, then the distill service + API wire data through, then the gate + UI collect it, and finally the test pins the behavior. The bio is threaded the same way sizing was in S-02 — resolved once, before the generation retry loop, and injected into the single pure `buildMessages` call so both retry attempts agree.

## Critical Implementation Details

- **Middleware loop-safety:** the onboarding gate must exempt `/onboarding`, `/api/onboarding`, the auth routes (`/auth/*`, `/api/auth/*`), and signout — otherwise redirecting a not-yet-onboarded user to `/onboarding` would itself be intercepted and loop. Gate only authenticated users, and only when the target is a gated app surface.
- **Bio resolved once, before the retry loop:** like sizing in S-02, load/pass the bio before `buildMessages` so both generation attempts use the identical prompt. Do not re-read it per attempt.
- **Distill resilience (no hard block):** the onboarding API must never fail the whole flow on an LLM error. Wrap the distill call; on any failure, fall back to persisting the learner's concatenated raw answers as the bio and still set `onboarded_at`. The forced gate makes this non-negotiable — an LLM outage must not lock new learners out of the product (PRD reliability guardrail).
- **Null-bio is a first-class path:** `buildMessages` emits **no** bio block when the bio is null/empty, so historical sessions and any skipped onboard generate exactly as S-02 does. There is no "empty bio" placeholder line.

## Phase 1: Profiles schema + bio types foundation

### Overview

Create the `profiles` table with the F-01 RLS template (PK = `user_id`), regenerate the committed DB types, and add the `Profile` types to `src/types.ts`.

### Changes Required:

#### 1. Migration — `profiles` table

**File**: `supabase/migrations/<timestamp>_profiles_bio.sql`

**Intent**: Persist a one-row-per-learner profile carrying the free-text bio and an onboarding-completion marker, isolated per learner with the same RLS pattern every other table uses.

**Contract**: `create table public.profiles` with `user_id uuid primary key references auth.users(id) on delete cascade`, `bio text` (nullable), `onboarded_at timestamptz` (nullable — null = not yet onboarded), `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`. Enable RLS and add the four-policy template (`select`/`insert`/`update`/`delete` for `authenticated`) with predicate `user_id = (select auth.uid())` — note the predicate keys off `user_id` (which is the PK here), so no `id` column. Reuse the existing `updated_at` trigger pattern from `20260607131334_sessions_updated_at_trigger.sql` if it is generic, or add an equivalent trigger for `profiles`. No `delete`-from-app path is used in this slice, but the policy is included for template consistency.

#### 2. Regenerate DB types

**File**: `src/db/database.types.ts`

**Intent**: Reflect the new `profiles` table in the committed generated types so the API and middleware are type-safe.

**Contract**: Run `npx supabase gen types typescript --local`, then Prettier-format to match the committed style. `profiles.Row`/`Insert`/`Update` appear.

#### 3. Shared profile types

**File**: `src/types.ts`

**Intent**: One canonical place to import the profile row type and the bio concept, mirroring how `Session`/`SessionIntake` are exported.

**Contract**: Export `Profile = Tables["profiles"]["Row"]` (+ `Insert`/`Update`). Add a `BIO_MAX` length constant (e.g. matching whatever cap the distill/raw-answer path enforces) and, if helpful, a `LearnerBio = string` alias for readability at call sites. No behavior — types/constants only.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset` (local) succeeds.
- pgTAP suite still green: `npx supabase test db`.
- Generated types match after Prettier (no drift): `npx supabase gen types typescript --local` matches `src/db/database.types.ts`.
- Build green: `npm run build`.
- Lint green: `npm run lint`.

#### Manual Verification:

- In Studio, a `profiles` insert for one user is invisible to a different authenticated user (RLS isolation), mirroring the cross-account check used for `sessions`.
- `onboarded_at` defaults to null on an inserted row with only `user_id` set.

---

## Phase 2: Bio in generation

### Overview

Extend the generation entry point and the pure prompt builder to accept an optional bio and inject it as a framing block, omitted entirely when absent. No sizing change.

### Changes Required:

#### 1. Bio-aware prompt builder

**File**: `src/lib/services/generation/generate.ts`

**Intent**: Inject the bio as long-term framing (idiom + default depth) into the system prompt, beneath the existing grounding rules and above/alongside the intake block, without touching the citation-grounding rules or the sizing-driven counts.

**Contract**: `buildMessages` signature becomes `buildMessages(sourceText, intake, sizing, bio?: string | null)`. When `bio` is a non-empty (trimmed) string, append a framing line to the system message (e.g. a "Learner background" directive instructing the model to match idiom and assume the bio's baseline familiarity *without* overriding the per-session knowledge level or the counts). When `bio` is null/empty, emit nothing extra — the prompt is byte-identical to today's. Stays pure (same inputs → same messages). `generateSession` signature becomes `generateSession(sourceText, intake, bio?: string | null)`; it passes `bio` straight through to `buildMessages` (resolved once, before the retry loop — alongside `sizing`). Grounding check, schema factory, and retry logic unchanged.

### Success Criteria:

#### Automated Verification:

- Build green: `npm run build`.
- Lint green: `npm run lint`.
- Type check via build: no `tsc` errors (the `/api/sessions` caller is updated in Phase 3; until then the optional param keeps it compiling).

#### Manual Verification:

- Logging the built messages for a non-empty bio shows the background framing line present; for a null bio the messages match the pre-change output exactly.
- A live generation with two different bios on the same source + intake returns visibly different prose framing (same step/MCQ counts).

---

## Phase 3: Distill service + API wiring

### Overview

Add a bio-distill service (pure prompt builder + LLM call with raw-answers fallback), a `POST /api/onboarding` endpoint that distills and upserts the profile, and load the bio by `user_id` in `POST /api/sessions`.

### Changes Required:

#### 1. Bio distill service

**File**: `src/lib/services/onboarding/distill.ts`

**Intent**: Turn the learner's short onboarding answers into a clean free-text bio via one LLM call, with a deterministic fallback so the flow never hard-fails.

**Contract**: Export a pure `buildDistillMessages(answers: string[] | Record<string,string>)` that renders a system+user prompt asking the model to synthesize a concise third-person background bio (role, experience, domains) from the answers, capped at `BIO_MAX`. Export `async distillBio(answers): Promise<string>` that calls `getOpenRouterClient()`/`getModel()` (reusing the S-01 client), returns the trimmed model text on success, and on **any** error (config, API, empty) returns the concatenated raw answers (trimmed, capped at `BIO_MAX`) instead of throwing. The raw-answer fallback is the resilience contract from the plan's decisions.

#### 2. Onboarding completion endpoint

**File**: `src/pages/api/onboarding/index.ts`

**Intent**: Accept the onboarding answers, produce a bio, and mark the learner onboarded — the single write that satisfies the gate.

**Contract**: `export const prerender = false`. `POST` handler: require `context.locals.user` (else 401). Parse + zod-validate the answers from the request body (each answer non-empty, total within a sane cap); on invalid input return 400 with an explanatory `error`. Call `distillBio(answers)` (never throws per its contract). **Upsert** `profiles` (`user_id` conflict target) with `{ user_id, bio, onboarded_at: now() }`. On DB error return 500. On success return 200/201. Mirrors the JSON-response style of `api/sessions/index.ts`.

#### 3. Load bio in session creation

**File**: `src/pages/api/sessions/index.ts`

**Intent**: Feed the learner's stored bio into generation so every session is bio-tailored.

**Contract**: After intake validation and **before** `generateSession`, read the current user's `profiles.bio` (single select by `user_id`; tolerate "no row"/null). Pass it as the third argument: `generateSession(extractedText, intake, bio)`. A null/missing bio is passed through unchanged (Phase 2 omits the block). No change to persistence, storage, or cleanup logic.

### Success Criteria:

#### Automated Verification:

- Build green: `npm run build`.
- Lint green: `npm run lint`.

#### Manual Verification:

- `POST /api/onboarding` with valid answers creates/updates the caller's `profiles` row with a non-null `bio` and `onboarded_at` (check in Studio); a second POST upserts (no duplicate row).
- With the OpenRouter key temporarily unset (or model forced to error), `POST /api/onboarding` still succeeds and stores the concatenated raw answers as the bio (fallback verified).
- After onboarding, creating a session loads the bio (log/inspect the generation messages to confirm the framing line is present).

---

## Phase 4: Onboarding gate + UI

### Overview

Add the middleware redirect that forces not-yet-onboarded learners to `/onboarding`, and build the bounded guided-chat onboarding page + island.

### Changes Required:

#### 1. Onboarding gate in middleware

**File**: `src/middleware.ts`

**Intent**: Guarantee a bio exists before a learner reaches any gated app surface, without creating a redirect loop.

**Contract**: After `context.locals.user` is resolved and the existing protected-route auth check, add: if the user is authenticated AND the path is a gated app surface (the existing `PROTECTED_ROUTES`, and optionally `/`) AND the path is NOT itself exempt (`/onboarding`, `/api/onboarding`, `/auth/*`, `/api/auth/*`), then read the caller's `profiles.onboarded_at`; if no row or null, `return context.redirect("/onboarding")`. Keep the read scoped so it only runs when a redirect could apply (don't read on exempt paths). Expose the resolved onboarding state on `context.locals` only if a page needs it (optional).

#### 2. Onboarding page

**File**: `src/pages/onboarding.astro`

**Intent**: Host the onboarding chat for authenticated, not-yet-onboarded learners.

**Contract**: A `Layout`-wrapped page (cosmic styling consistent with `dashboard.astro`/`account.astro`) that renders the `OnboardingChat` island `client:load`. Guard: if the user is already onboarded, redirect to `/dashboard` (so a direct visit post-onboarding doesn't show the flow). Brief intro copy framing the tutor's questions.

#### 3. Onboarding chat island

**File**: `src/components/onboarding/OnboardingChat.tsx`

**Intent**: Collect 2–3 scripted answers in a chat-style UI and submit them to the onboarding endpoint.

**Contract**: A React island presenting a fixed script of 2–3 tutor prompts (e.g. current role, experience level, domains/topics you know) one at a time or as a short stacked chat, each capturing free-text. "Finish" is disabled until the required answers are non-empty. On submit, `POST /api/onboarding` with the answers (JSON body); on success redirect to `/dashboard`; on error show an inline message and allow retry (busy/disabled state during the request). Plain controls + `fetch` only — no browser-only library (lesson-compliant). Reuse existing Tailwind/`cn()` conventions; no new UI dependency.

### Success Criteria:

#### Automated Verification:

- Build green: `npm run build`.
- Lint green: `npm run lint`.

#### Manual Verification:

- A brand-new (or bio-null) learner is redirected to `/onboarding` on first hit of `/dashboard`, `/account`, or `/sessions/*`; they cannot reach those surfaces until they complete onboarding.
- No redirect loop: `/onboarding`, signin/signup, and signout all remain reachable while not onboarded.
- Completing the chat stores the bio, sets `onboarded_at`, and lands on `/dashboard`; revisiting `/onboarding` afterward redirects to `/dashboard`.
- An already-onboarded learner is never gated.

---

## Phase 5: Verification (Vitest)

### Overview

Extend the existing prompt-level test harness to prove the bio measurably tailors the generated prompt — the roadmap's named S-03 verification.

### Changes Required:

#### 1. Bio prompt-level assertions

**File**: `src/lib/services/generation/generate.test.ts`

**Intent**: Pin FR-006's bio half at the prompt level using the pure `buildMessages`, mirroring the S-02 intake assertions.

**Contract**: Add cases asserting: (a) a non-empty bio appears in the rendered system message; (b) a null/empty bio produces messages byte-identical to the no-bio path (the omission contract); (c) two different bios yield different prompts with the same source + intake + sizing. No live OpenRouter call. Existing intake/sizing assertions remain unchanged and green.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes locally (new bio cases + existing suite).
- CI `ci` job runs the existing test step and is green on push.
- Build + lint still green: `npm run build`, `npm run lint`.

#### Manual Verification:

- Deliberately stubbing `buildMessages` to ignore the bio fails the new assertions — confirms they have teeth.

---

## Testing Strategy

### Unit Tests (Vitest):

- `buildMessages` with bio: present-bio appears in prompt; null-bio omitted (byte-identical to no-bio); two bios ⇒ different prompts. Existing intake/sizing tests untouched.

### Integration / DB Tests (existing pgTAP):

- `supabase test db` stays green. `profiles` carries the four-policy RLS template; a cross-account read returns no rows (optionally add a pgTAP assertion if cheap, mirroring the existing per-table checks).

### Manual Testing Steps:

1. New learner (or set an existing learner's `profiles.bio`/`onboarded_at` to null): sign in → confirm forced redirect to `/onboarding`; confirm `/dashboard`, `/account`, `/sessions/new` all bounce to `/onboarding` until completion.
2. Complete the 2–3-turn chat → confirm the `profiles` row has a non-null `bio` + `onboarded_at`, and you land on `/dashboard`.
3. Temporarily break the LLM (unset key / force model error) and onboard a fresh learner → confirm the flow still completes and stores the raw answers as the bio.
4. Start two sessions on the same file + same intake, once with a "first-year student" bio and once with a "senior engineer" bio → confirm prose framing differs while step/MCQ counts match.
5. Open a historical S-01/S-02 session (null bio) → confirm it renders unchanged.
6. Confirm an already-onboarded learner is never redirected to `/onboarding`.

## Performance Considerations

The middleware adds **one cheap `profiles` read** on authenticated requests to gated surfaces (skipped on exempt paths). At MVP's low QPS this is negligible; if it ever matters, the onboarding flag is a candidate for caching in session/user metadata (out of scope now). The onboarding distill is one bounded LLM call at first sign-in only — not on the hot session path. Session generation gains a single `profiles.bio` select before the existing generation call; no added per-token cost beyond a short framing line in the prompt.

## Migration Notes

- `profiles` is a new table; nothing to backfill. Existing learners have no row → they hit the gate and onboard on next sign-in. Their historical sessions (null bio) render unchanged.
- Forward deploy: apply the migration to prod (`supabase db push`) **before** the code deploy, per the established schema-before-code ordering (S-01/S-02).

## References

- Roadmap slice: `context/foundation/roadmap.md` → S-03 (`onboarding-bio-tailoring`).
- PRD: FR-005, FR-006, US-01 (`context/foundation/prd.md:110-113`).
- S-02 prior art (mirror its shape): `context/archive/2026-06-08-per-session-intake-tailoring/plan.md`.
- Generation to extend: `src/lib/services/generation/generate.ts:30,75`, `sizing.ts`, `openrouter.ts`.
- API + middleware to extend: `src/pages/api/sessions/index.ts`, `src/middleware.ts`.
- RLS template: `docs/reference/rls-policy-template.md`; baseline migration `supabase/migrations/20260528202720_domain_schema_rls_baseline.sql`.
- Lesson: `context/foundation/lessons.md` — lazy-import browser-only libs in SSR'd islands.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Profiles schema + bio types foundation

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — ccb66fe
- [x] 1.2 pgTAP suite green: `npx supabase test db` — ccb66fe
- [x] 1.3 Generated types match after Prettier (no drift) — ccb66fe
- [x] 1.4 Build green: `npm run build` — ccb66fe
- [x] 1.5 Lint green: `npm run lint` — ccb66fe

#### Manual

- [x] 1.6 Cross-account `profiles` read returns no rows (RLS isolation) — ccb66fe
- [x] 1.7 `onboarded_at` defaults to null on a minimal inserted row — ccb66fe

### Phase 2: Bio in generation

#### Automated

- [x] 2.1 Build green: `npm run build` — ee48987
- [x] 2.2 Lint green: `npm run lint` — ee48987
- [x] 2.3 No type errors via build (caller updated in Phase 3) — ee48987

#### Manual

- [x] 2.4 Non-empty bio adds the framing line; null bio matches pre-change messages exactly — ee48987
- [x] 2.5 Two bios on same source + intake yield different prose, same counts — ee48987

### Phase 3: Distill service + API wiring

#### Automated

- [x] 3.1 Build green: `npm run build` — 3e3ca17
- [x] 3.2 Lint green: `npm run lint` — 3e3ca17

#### Manual

- [x] 3.3 `POST /api/onboarding` upserts a `profiles` row with non-null bio + `onboarded_at` (no duplicate on second POST) — 3e3ca17
- [x] 3.4 Distill failure path stores concatenated raw answers as the bio — 3e3ca17
- [x] 3.5 Session creation loads the bio into the generation messages — 3e3ca17

### Phase 4: Onboarding gate + UI

#### Automated

- [x] 4.1 Build green: `npm run build`
- [x] 4.2 Lint green: `npm run lint`

#### Manual

- [x] 4.3 Not-yet-onboarded learner is forced to `/onboarding` from every gated surface
- [x] 4.4 No redirect loop: `/onboarding`, auth routes, signout reachable while not onboarded
- [x] 4.5 Completing onboarding stores bio + `onboarded_at` and lands on `/dashboard`; revisiting `/onboarding` redirects away
- [x] 4.6 Already-onboarded learner is never gated

### Phase 5: Verification (Vitest)

#### Automated

- [ ] 5.1 `npm run test` passes locally (new bio cases + existing suite)
- [ ] 5.2 CI `ci` job runs the test step and is green
- [ ] 5.3 Build + lint still green

#### Manual

- [ ] 5.4 Stubbing `buildMessages` to ignore the bio fails the new assertions (teeth)
