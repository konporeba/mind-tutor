# Session History View (S-06) Implementation Plan

## Overview

Make a learner's past sessions revisitable. Today a session is fully persisted (S-01) and the
detail page at `/sessions/[id]` already replays theory, exercises (with the original answers), and
the score — but there is **no way to find a past session** (the dashboard has no list), and the
detail view shows neither the **uploaded file** nor the **conversation log**. This slice adds the
dashboard history list as the entry point and augments the detail view with a Storage-backed file
download and a read-only conversation transcript, all RLS-scoped per learner. Completes the read
half of FR-014.

## Current State Analysis

- **Sessions persist completely.** `sessions` carries `status` (`active`/`completed`/`abandoned`),
  `score`, `title`, `created_at`, `completed_at`
  (`supabase/migrations/20260528202720_domain_schema_rls_baseline.sql:23-32`). Child rows
  (`materials`, `generated_content`, `exercises`, `conversation_messages`) all carry a denormalized
  `user_id` under the F-01 four-policy RLS template.
- **The detail page already replays a session read-only-ish.** `src/pages/sessions/[id].astro`
  loads the session via `.single()` (RLS-scoped — a non-owned/missing id redirects to `/dashboard`,
  `:21-29`), then theory + exercises, and hands them to `SessionRunner`. For a **completed** session
  every exercise is already answered, so the runner locks inputs and hides "Finish" and shows the
  score/trophy — effectively read-only already (`SessionRunner.tsx:296-345`). It does **not** query
  `materials` or `conversation_messages`.
- **No history list anywhere.** `dashboard.astro:1-41` is a static welcome card with "Start new
  session" / Account / Sign out — a past session is reachable only by knowing its URL.
- **`conversation_messages` is live** (S-05 Phase 2, commit `0f12f8b`): append-only turns
  (`role` `user`/`assistant`, `position`, `content`) under per-learner RLS
  (`supabase/migrations/20260623000000_conversation_messages.sql`). `ConversationMessage` is already
  re-exported from `src/types.ts:39-41`.
- **S-05's *live* conversation UI is mid-flight on this branch** (AskTutorPanel + SSR turn-load are
  S-05 Phase 4, still unchecked in `context/changes/ask-tutor-mid-session/plan.md:486-498`). S-06
  must not depend on it landing first.
- **Materials bytes live in a private Storage bucket** `materials`, path `${user}/${session}/${file}`
  (`src/pages/api/sessions/index.ts:142-145`); `materials.storage_path` records it.
- **A real cross-account integration harness exists**: `getIdentities()` returns live anon-key
  clients authed as learner A and B (`src/test/integration/setup.ts`), and `createSessionGraph()`
  seeds an owned session graph (`src/test/integration/factories.ts`). RLS is the thing under test —
  exactly the pattern the verification phase reuses.

## Desired End State

A signed-in learner lands on the dashboard and sees their sessions listed newest-first, each row
showing title, score (when completed), a status badge, and the date, linking to `/sessions/[id]`.
Opening a session shows — in addition to the existing theory/exercises/score replay — the uploaded
file(s) with a working download link, and, for a completed session, a read-only transcript of the
ask-the-tutor conversation. A learner can never see or open another learner's session, list row, or
conversation, even by guessing an id — proven by an integration test that runs through real RLS.

**Verification**: `npm run lint`, `npm run build`, `npx supabase test db`, `npm test` all green; the
dashboard lists the learner's sessions; a completed session shows a downloadable file and the
read-only transcript; learner B cannot list or open learner A's data.

### Key Discoveries:

- The detail page's `.single()` load is already the RLS gate — a non-owner id redirects
  (`src/pages/sessions/[id].astro:21-29`); the new list/detail queries inherit the same isolation.
- `ConversationMessage` is already exported from `types.ts` — no migration or type regen needed.
- The integration harness (`getIdentities` + `createSessionGraph`) is the chosen vehicle for the
  cross-account read test; `createSessionGraph` currently seeds an **active** session and **no**
  conversation row, so the test will set status/insert a turn explicitly.
- Read-only sections (file download link, transcript bubbles) are static — render as Astro markup /
  presentational components, not a React island (CLAUDE.md: Astro for static, React only for
  interactivity).
- Signed URLs come from `supabase.storage.from("materials").createSignedUrl(path, ttl)` — generated
  server-side in the detail page frontmatter.

## What We're NOT Doing

- **No live ask-the-tutor panel.** Posting new questions is S-05; S-06 renders the conversation
  **read-only** and only for completed sessions. Active sessions keep S-05's live panel (when it
  lands).
- **No delete / edit of sessions or turns.** Delete-session is S-07; turns are append-only.
- **No pagination / search / filtering** of the history list — a simple newest-first list for MVP.
- **No mid-session resume affordance.** Active sessions appear in the list with a badge and link to
  the existing runner; no new resume logic is added (PRD non-goal).
- **No change to how exercises/theory/score render** — that replay already works for completed
  sessions.
- **No new migration or type regeneration** — all tables and the `ConversationMessage` type exist.

## Implementation Approach

Build the entry point first (Phase 1: dashboard list), then enrich the detail view (Phase 2:
file download + read-only transcript), then prove isolation and sweep for regressions (Phase 3).
To make the SSR read path testable through the existing two-identity harness, the **new** queries
are extracted into small client-taking helpers under `src/lib/services/history/`; the detail page's
pre-existing inline theory/exercise loads are left untouched. The read-only transcript is built
independently of S-05's in-flight live panel so neither blocks the other; if S-05 later wants to
share a transcript renderer, that is a small follow-up reconciliation, not a dependency here.

## Critical Implementation Details

- **S-05 / S-06 detail-page coexistence**: both slices touch `src/pages/sessions/[id].astro` and
  want to read `conversation_messages`. S-06 renders the transcript **only when
  `session.status === "completed"`**; S-05 owns the active-session live panel. Gating on status keeps
  the two from double-rendering the conversation on the same page when both have landed.
- **Signed-URL lifecycle**: `createSignedUrl` returns a short-lived URL (use a small TTL, e.g. 60s) —
  generated per page render, so a stale link just needs a refresh. A missing/`NULL` `storage_path`
  (legacy/edge rows) must render filename-only without erroring.

## Phase 1: Dashboard session history list

### Overview

Turn the dashboard into the history entry point: list the learner's sessions newest-first with
title, score, status badge, and date, each linking to its detail view, with an empty state.

### Changes Required:

#### 1. Session-list read helper

**File**: `src/lib/services/history/sessions.ts` (new)

**Intent**: A small, unit/integration-testable function that reads the current learner's sessions
for the history list, so the cross-account test (Phase 3) can exercise it through the real RLS
harness rather than against inline `.astro` frontmatter.

**Contract**: `listSessions(supabase: SupabaseClient<Database>)` returns the learner's `sessions`
rows selecting `id, title, status, score, created_at`, ordered `created_at` descending. RLS scopes
the result to the owner; no explicit `user_id` filter is required (defense-in-depth filter optional,
matching existing read patterns). Returns `[]` on no rows.

#### 2. Dashboard list rendering

**File**: `src/pages/dashboard.astro`

**Intent**: Call `listSessions`, render each session as a row (title, score when present, status
badge, formatted date) linking to `/sessions/[id]`; show a friendly empty state when there are none;
keep the existing "Start new session" / Account / Sign out actions.

**Contract**: Frontmatter constructs the supabase client (as in `[id].astro`) and calls
`listSessions`. Markup: a list where each row is an `<a href={`/sessions/${s.id}`}>` exposing the
title as link text (accessible name), a status badge for `active`/`completed`/`abandoned`, the score
shown only when non-null, and a human date from `created_at`. **Active rows read "In progress ·
Resume"** (the link resumes the existing runner, which already restores state — no new resume logic);
completed/abandoned rows read as a finished record. Empty state is visible text plus the existing
new-session CTA. Tailwind matches the existing card idiom
(`rounded-2xl border border-white/10 bg-white/10 ... backdrop-blur-xl`).

#### 3. Status badge presentation

**File**: `src/components/session/SessionStatusBadge.astro` (new) — or inline in the dashboard if trivial

**Intent**: Render a consistent, accessible status badge so list rows (and later the detail header)
can reuse it.

**Contract**: Takes a `status` (`active`/`completed`/`abandoned`) and renders a small labeled badge
with a per-status colour; the status word is readable text (not colour-only).

### Success Criteria:

#### Automated Verification:

- Type checking + lint passes: `npm run lint`
- Build succeeds: `npm run build`
- `listSessions` unit/integration test passes: `npm test`

#### Manual Verification:

- The dashboard lists the signed-in learner's sessions, newest first, each linking to its detail view.
- Rows show title, status badge, date, and score (for completed sessions).
- A learner with no sessions sees the empty state and the "Start new session" CTA.

**Implementation Note**: After this phase and all automated verification passes, pause for manual
confirmation before proceeding.

---

## Phase 2: Detail view — uploaded files + read-only conversation log

### Overview

Augment `/sessions/[id]` with the uploaded file(s) as a Storage signed-URL download, and a read-only
conversation transcript shown for completed sessions — independent of S-05's live panel.

### Changes Required:

#### 1. Materials read + signed-URL load

**File**: `src/lib/services/history/materials.ts` (new) and `src/pages/sessions/[id].astro`

**Intent**: Load the session's material rows and produce a short-lived download URL per file so the
learner can re-open the original upload from the private `materials` bucket.

**Contract**: A helper `loadSessionMaterials(supabase, sessionId)` selecting
`id, filename, mime_type, size_bytes, storage_path` for the session (RLS-scoped, defense-in-depth
`.eq("session_id", id)`). In `[id].astro`, for each material with a non-null `storage_path` call
`supabase.storage.from("materials").createSignedUrl(storage_path, <ttl>)` and pass
`{ filename, sizeBytes, downloadUrl | null }` to the view. A `NULL` path or a signing error yields a
filename-only entry (no throw).

#### 2. Materials section UI

**File**: `src/pages/sessions/[id].astro` (markup) — small presentational component if it grows

**Intent**: Show the uploaded file(s) with filename, size, and a download link when available.

**Contract**: A "Materials" section listing each file; a download is an `<a href={downloadUrl}>` with
the filename as accessible text; files without a URL show filename + size only. Tailwind matches the
existing panel idiom.

#### 3. Read-only conversation transcript

**File**: `src/components/session/ConversationLog.astro` (new) and `src/pages/sessions/[id].astro`

**Intent**: SSR-load the session's conversation turns and render them as a read-only transcript for
completed sessions, so a learner can revisit the Q&A — without any input affordance and without
depending on S-05's live panel.

**Contract**: A helper `loadConversation(supabase, sessionId)` selecting `role, content, position`
ordered by `position` (RLS-scoped, defense-in-depth `.eq("session_id", id)`). `ConversationLog.astro`
takes the ordered `ConversationMessage`-shaped turns and renders user/assistant bubbles (distinct
styling per role; reuse the bubble idiom from `OnboardingChat.tsx`), with **no** textarea/send
control. In `[id].astro`, render `<ConversationLog>` **only when `session.status === "completed"`**;
when there are zero turns, render a brief "No questions were asked in this session" empty line (or
omit the section). Selecting `session.status` requires adding `status` to the existing session
`.select(...)` (it already selects `status`).

### Success Criteria:

#### Automated Verification:

- Type checking + lint passes: `npm run lint`
- Build succeeds: `npm run build`
- `loadSessionMaterials` / `loadConversation` tests pass: `npm test`

#### Manual Verification:

- Opening a completed session shows the uploaded file with a working download link.
- A completed session with prior Q&A shows the read-only transcript (correct user/assistant order),
  with no way to send a new message.
- A completed session with no conversation renders gracefully (empty line or omitted section).
- A material row with a missing `storage_path` shows filename-only without an error.

**Implementation Note**: After this phase and all automated verification passes, pause for manual
confirmation before proceeding.

---

## Phase 3: Cross-account RLS read verification + regression sweep

### Overview

Prove a learner cannot list or open another learner's sessions, materials, or conversation through
the read path, and confirm no regressions across the suites.

### Changes Required:

#### 1. Cross-account read integration test

**File**: `src/lib/services/history/history.integration.test.ts` (new)

**Intent**: Exercise the new read helpers through real RLS with two identities, proving learner B
sees none of learner A's data and (control) does see its own.

**Contract**: Using `getIdentities()` + `createSessionGraph()`, seed an A-owned and a B-owned session
graph (set one to `completed` and insert a `conversation_messages` turn via the owner's client where
the assertion needs it). Assert: `listSessions(clientB)` contains B's session id and **not** A's;
`loadSessionMaterials(clientB, aSessionId)` and `loadConversation(clientB, aSessionId)` return empty;
the same calls for B's own session return rows (control). Mirrors the construction in
`complete.integration.test.ts` and `setup.ts`.

#### 2. Extend DB isolation test (if gap)

**File**: `supabase/tests/rls_isolation_test.sql`

**Intent**: Ensure SELECT-isolation on `sessions` and `conversation_messages` is asserted at the DB
layer (some tables already are); add assertions only for any not yet covered and bump `plan(N)`.

**Contract**: Add cross-learner SELECT-denial assertions for the uncovered table(s), incrementing the
`plan(N)` count by exactly the number added; keep the existing effect-based style.

#### 3. Full regression sweep

**File**: — (verification only)

**Intent**: Confirm green across lint, build, DB tests, and the unit/integration suite.

**Contract**: `npm run lint`, `npm run build`, `npx supabase test db`, `npm test` all pass.

### Success Criteria:

#### Automated Verification:

- Cross-account read integration test passes: `npm test`
- RLS isolation tests pass: `npx supabase test db`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- With two real accounts, learner B cannot see learner A's sessions on the dashboard and is
  redirected when navigating directly to A's `/sessions/[id]`.

**Implementation Note**: Final phase — confirm the cross-account behavior and full regression before
archiving.

---

## Testing Strategy

### Unit / Integration Tests:

- `listSessions` returns the owner's sessions newest-first and excludes other learners' rows (RLS).
- `loadSessionMaterials` / `loadConversation` return owner rows and nothing cross-account.
- Cross-account control: each helper returns the caller's own data (guards against a spurious empty).

### Manual Testing Steps:

1. Sign in with sessions present → dashboard lists them newest-first with badges/scores.
2. Open a completed session → file downloads via the link; read-only transcript renders in order.
3. Open an active session → appears with an active badge; no S-06 read-only transcript shown.
4. Sign in as a second learner → none of the first learner's sessions appear; direct-URL access to
   the first learner's session redirects.
5. Open a completed session that had no Q&A → graceful empty/omitted conversation section.

## Performance Considerations

- The list query selects a handful of columns ordered by an indexed-by-`user_id` table; no pagination
  needed at MVP volumes.
- Signed URLs are generated per render with a short TTL — cheap, no caching layer required.

## Migration Notes

- No schema changes: all tables (`sessions`, `materials`, `conversation_messages`) and the
  `ConversationMessage` type already exist. Pure read-path additions.

## References

- Roadmap slice S-06: `context/foundation/roadmap.md:152-162`
- Detail page (RLS-scoped load pattern): `src/pages/sessions/[id].astro:21-29`
- Session replay island: `src/components/session/SessionRunner.tsx`
- Conversation table + RLS: `supabase/migrations/20260623000000_conversation_messages.sql`
- Shared type: `src/types.ts:39-41`
- Storage upload (bucket + path convention): `src/pages/api/sessions/index.ts:142-145`
- Cross-account harness: `src/test/integration/setup.ts`, `src/test/integration/factories.ts`
- Isolation control example: `src/pages/api/sessions/[id]/complete.integration.test.ts`
- Bubble UI analog: `src/components/onboarding/OnboardingChat.tsx`
- Related (parallel) slice: `context/changes/ask-tutor-mid-session/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Dashboard session history list

#### Automated

- [x] 1.1 Type checking + lint passes: `npm run lint` — 435a091
- [x] 1.2 Build succeeds: `npm run build` — 435a091
- [x] 1.3 `listSessions` unit/integration test passes: `npm test` — 435a091

#### Manual

- [x] 1.4 Dashboard lists the learner's sessions newest-first, each linking to its detail view — 435a091
- [x] 1.5 Rows show title, status badge, date, and score (for completed sessions); active rows read "In progress · Resume" — 435a091
- [x] 1.6 A learner with no sessions sees the empty state and the new-session CTA — 435a091

### Phase 2: Detail view — uploaded files + read-only conversation log

#### Automated

- [x] 2.1 Type checking + lint passes: `npm run lint` — f07c54f
- [x] 2.2 Build succeeds: `npm run build` — f07c54f
- [x] 2.3 `loadSessionMaterials` / `loadConversation` tests pass: `npm test` — f07c54f

#### Manual

- [x] 2.4 Completed session shows the uploaded file with a working download link — f07c54f
- [x] 2.5 Completed session with prior Q&A shows the read-only transcript in order, no send control — f07c54f
- [x] 2.6 Completed session with no conversation renders gracefully — f07c54f
- [x] 2.7 Material row with a missing `storage_path` shows filename-only without error — f07c54f

### Phase 3: Cross-account RLS read verification + regression sweep

#### Automated

- [x] 3.1 Cross-account read integration test passes: `npm test` — 7354096
- [x] 3.2 RLS isolation tests pass: `npx supabase test db` — 7354096
- [x] 3.3 Lint passes: `npm run lint` — 7354096
- [x] 3.4 Build succeeds: `npm run build` — 7354096

#### Manual

- [x] 3.5 With two accounts, learner B cannot see A's sessions on the dashboard and is redirected from A's `/sessions/[id]` — 7354096
