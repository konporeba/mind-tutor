# Ask the Tutor Mid-Session (S-05) Implementation Plan

## Overview

Add an in-session "ask the tutor" chat panel: while running a session, a learner types
free-form questions about their uploaded material and receives answers **grounded only in the
source files** (`materials.extracted_text`), delivered as a **streamed (SSE)** response, with
each conversation turn **persisted** under per-learner RLS so a later history view (S-06) can
replay it. This completes FR-008. The product wedge — no off-source claims — is enforced at the
prompt level and guarded by an offline grounding eval.

## Current State Analysis

- **Source text is already persisted and queryable**: `materials.extracted_text` (text, nullable)
  keyed by `session_id` under the F-01 four-policy RLS, written at session creation
  (`src/pages/api/sessions/index.ts:159`). The S-01 migration comment explicitly names S-05 as
  the future consumer (`supabase/migrations/20260607150000_first_grounded_session.sql:6-9`).
- **Grounding prompt pattern exists**: `buildMessages()` (`src/lib/services/generation/generate.ts:54-96`)
  opens with the "Use ONLY facts present in the source. Never introduce outside knowledge…"
  system contract and injects source in a `"""`-fenced user message (`:90`). This *prompt language*
  is reusable; the session-sizing/JSON-schema machinery is not (it shapes theory/exercise structure).
- **OpenRouter client is a thin OpenAI-SDK wrapper**: `getOpenRouterClient()` / `getModel()`
  (`src/lib/services/generation/openrouter.ts:21-34`). Every call site today is **buffered** — no
  `stream: true` anywhere, and zero SSE/`ReadableStream`/`text/event-stream` in `src/`.
- **No conversation table exists**: both existing "chats" are non-persisted — S-02 intake is typed
  columns on `sessions`; S-03 onboarding is client state distilled to `profiles.bio` and discarded.
  Persisting Q&A turns is greenfield.
- **Canonical domain route + island patterns are settled**: `api/sessions/[id]/complete.ts:1-63`
  (prerender=false, `json()` helper, `context.locals.user` → 401, `createClient` → 500,
  `context.params.id` → 400, RLS + defense-in-depth `.eq("session_id", …)`); `SessionRunner.tsx`
  is one `client:load` island with a `lg:grid-cols-2` grid at `:407` and props at `:52-59`.
- **Grounding judge is test-only by design** (`src/lib/services/grounding/judge.ts:11-14`) and
  cannot judge a token stream — it stays an offline eval, never in the request path.

Full prior research: `context/changes/ask-tutor-mid-session/research.md`.

## Desired End State

A learner on `/sessions/[id]` sees an always-visible "Ask the tutor" panel below the theory/exercise
grid, usable during theory, during exercises, and after scoring. Typing a question streams back a
grounded answer token-by-token. Questions that the source can't answer get an on-source refusal that
invites rephrasing. Every user question and tutor answer is written to a new `conversation_messages`
table under per-learner RLS; reloading the session re-renders the prior turns. A cross-account learner
cannot read another learner's turns (proven by `rls_isolation_test.sql`). An opt-in grounding eval over
Q&A fixtures confirms answers stay on-source.

**Verification**: `npm run lint`, `npm run build`, `npx supabase test db`, `npm test` all green;
manual walkthrough streams a grounded answer, refuses an off-source question, and survives a reload
with turns intact.

### Key Discoveries:

- `materials.extracted_text` is the grounding corpus, already RLS-scoped (`database.types.ts:128`).
- Reuse the grounding *system prompt* from `generate.ts:71-90`; do **not** reuse `sizing.ts`/`schema.ts`.
- Streaming is net-new and unproven on `@astrojs/cloudflare` — Phase 1 spikes it before any UI work.
- New table must follow `docs/reference/rls-policy-template.md` verbatim and extend `rls_isolation_test.sql`.
- New endpoint belongs at `api/sessions/[id]/ask.ts`; panel is a self-contained child of `SessionRunner`.
- [[lessons.md]]: keep browser-only deps out of the SSR module graph — the streaming consumer uses
  browser-native `fetch().body.getReader()`, which is fine in a `client:load` island.

## What We're NOT Doing

- **No history-replay UI for past sessions** — rendering a completed session's conversation is S-06.
  This slice only re-renders the *current* session's turns on reload.
- **No editing or deleting of conversation turns** (turns are append-only; delete cascade is S-07's job).
- **No live per-turn grounding judge** in the request path — grounding is prompt-enforced and verified
  offline; a live judge would double latency/cost and can't operate on a stream.
- **No general-knowledge / off-source answering** — the tutor refuses on-source.
- **No new file-upload or parsing work** — Q&A grounds against already-extracted text.
- **No `updated_at` trigger on the new table** — turns are immutable (matches `generated_content`/`exercises`).

## Implementation Approach

De-risk the one unknown first (Phase 1: streaming on Workers), then build bottom-up: data model
(Phase 2) → grounded service + endpoint + persistence (Phase 3) → UI (Phase 4) → grounding eval and
regression (Phase 5). The transport decision from Phase 1 (SSE vs buffered fallback) is consumed by
Phases 3 and 4; the contract those phases depend on — a POST to `api/sessions/[id]/ask.ts` that returns
either a streamed body or a buffered JSON answer — is identical in shape either way, so a fallback does
not reshape the UI's request cycle.

## Critical Implementation Details

- **Timing & lifecycle (persistence)**: the user-question row is inserted **before** the LLM call so a
  crash/abort never loses the question; the assistant-answer row is inserted **only after** the stream
  completes successfully. An aborted stream therefore leaves a user turn with no paired answer — the SSR
  load and the panel must render an unanswered question gracefully (not as an error).
- **State sequencing (grounding context)**: each question is sent with the concatenated capped source
  **plus** the prior turns of the current session. The source is concatenated across all `materials`
  rows for the session and truncated to a fixed char budget (reuse the 60k cap convention); prior-turn
  context must also be bounded so a long conversation can't blow the token budget.
- **Streaming caveat**: streaming and `response_format: { type: "json_object" }` are mutually exclusive —
  the Q&A path streams **plain text**, a separate call shape from `generateSession`. Do not extend
  `generateSession`; write a parallel `answerQuestion` path.

## Phase 1: Streaming spike + transport decision

### Overview

Prove that a streamed `text/event-stream` / `ReadableStream` response body survives `@astrojs/cloudflare`
(workerd) end-to-end in dev and a production build, driven by the OpenAI SDK's `stream: true`. Lock the
transport: SSE if it holds, buffered request/response fallback if it doesn't. This gates Phases 3–4.

### Changes Required:

#### 1. Throwaway streaming probe route

**File**: `src/pages/api/_spike/stream.ts` (temporary; deleted at end of phase)

**Intent**: Confirm an Astro API route on the Cloudflare adapter can return a `ReadableStream` body that
the browser receives incrementally (not buffered to completion), both under `npm run dev` and
`npm run preview` against a production build.

**Contract**: `export const prerender = false`; `GET` returns `new Response(stream, { headers: { "Content-Type": "text/event-stream" } })` where `stream` emits a few chunks with an artificial delay between them. Observe whether chunks arrive incrementally.

#### 2. OpenAI-SDK streaming probe

**File**: extend the spike (or a scratch test) to call `getOpenRouterClient().chat.completions.create({ stream: true, … })`

**Intent**: Confirm the SDK's streamed async-iterable works through the OpenRouter base URL and that
deltas can be piped into the response stream. Gated behind the existing `E2E_STUB_OPENROUTER` seam so it
can run without burning real tokens where possible.

**Contract**: async iteration over `completion` yields `choices[0].delta.content` chunks; each is enqueued to the response stream.

#### 3. Record the decision

**File**: `context/changes/ask-tutor-mid-session/plan.md` (this file, Progress note) + a one-line note in `change.md` Notes.

**Intent**: Capture "SSE confirmed" or "fell back to buffered" so Phases 3–4 read a settled transport, not an open question.

**Contract**: A single recorded outcome string; the spike route is deleted before the phase closes.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Production build succeeds with the probe present: `npm run build`

#### Manual Verification:

- Under `npm run dev`, the probe route delivers chunks **incrementally** (visible delay between chunks in browser devtools / curl), not all at once.
- Under `npm run preview` (production build on workerd), streaming behaves the same — OR the limitation is observed and the buffered fallback is selected.
- The OpenAI-SDK `stream: true` call yields incremental deltas through OpenRouter.
- Transport decision recorded; the `src/pages/api/_spike/` route is removed.

**Implementation Note**: After this phase and all automated verification passes, pause for manual
confirmation of the streaming behavior and the recorded transport decision before proceeding.

---

## Phase 2: conversation_messages table + RLS + isolation

### Overview

Create the `conversation_messages` table following the F-01 RLS template, prove cross-account isolation,
and surface the generated + shared types.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_conversation_messages.sql`

**Intent**: Persist ordered, append-only Q&A turns per session under per-learner RLS, with cascade
delete so S-07 cleanup and account deletion remove turns automatically.

**Contract**: Table `public.conversation_messages` with `id uuid pk default gen_random_uuid()`,
`user_id uuid not null references auth.users(id) on delete cascade`, `session_id uuid not null references public.sessions(id) on delete cascade`,
`role text not null check (role in ('user','assistant'))`, `position int not null`, `content text not null`,
`created_at timestamptz not null default now()`; indexes on `user_id` and `session_id`; RLS enabled with
the four per-operation policies (`select`/`insert`/`update`/`delete`) using `user_id = (select auth.uid())`
`to authenticated`, copied verbatim from `docs/reference/rls-policy-template.md`. No `updated_at`/trigger
(turns are immutable).

#### 2. RLS isolation test

**File**: `supabase/tests/rls_isolation_test.sql`

**Intent**: Prove learner B cannot read learner A's conversation turns, consistent with the existing
per-table isolation assertions.

**Contract**: Seed a learner-A and learner-B `conversation_messages` row, assert each learner sees only
their own, and bump `plan(N)` by the added assertion count.

#### 3. Regenerate + re-export types

**File**: `src/db/database.types.ts` (regen) and `src/types.ts` (add `ConversationMessage` row/insert types)

**Intent**: Make the new table available to the app through the shared `types.ts` surface rather than
importing generated types directly.

**Contract**: `npx supabase gen types` updates `database.types.ts`; `types.ts` exports a
`ConversationMessage` row type and an insert type derived from it.

### Success Criteria:

#### Automated Verification:

- RLS isolation tests pass: `npx supabase test db`
- Type checking passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Migration applies cleanly against a local Supabase (`npx supabase db reset` or `db push`).
- `database.types.ts` shows the new table; `types.ts` exports `ConversationMessage`.

**Implementation Note**: Pause for manual confirmation that the migration applied and isolation tests
pass before proceeding.

---

## Phase 3: Grounded Q&A service + ask endpoint + persistence

### Overview

Add the grounded `answerQuestion` service and the `api/sessions/[id]/ask.ts` route that streams (or
buffers, per Phase 1) the answer and persists both turns.

### Changes Required:

#### 1. Grounded Q&A service

**File**: `src/lib/services/qa/answer.ts` (new)

**Intent**: Build the message array for a Q&A turn — grounding system prompt (reused language from
`generate.ts:71-88`), concatenated capped source text, bounded prior-turn context, and the new question —
then call the OpenRouter client (streaming if Phase 1 confirmed it, else buffered) and return the answer
(stream handle or full string). Instruct the model to refuse on-source when the answer isn't in the
material and invite rephrasing.

**Contract**: A pure `buildQaMessages(sourceText, priorTurns, question)` helper (unit-testable, mirrors
`buildMessages`) plus an `answerQuestion(...)` entry that consumes it. Source is concatenated across all
session `materials.extracted_text` rows and `.slice(0, MAX_SOURCE_CHARS)`; prior turns are capped to a
bounded count/char budget. Errors surface as `GenerationError` (reuse the existing type).

#### 2. Ask endpoint

**File**: `src/pages/api/sessions/[id]/ask.ts` (new)

**Intent**: Accept a question for a session the learner owns, fetch source + prior turns (RLS-scoped),
persist the user turn, call `answerQuestion`, stream/return the answer, then persist the assistant turn
on completion.

**Contract**: `export const prerender = false`; `POST: APIRoute` following the canonical pattern
(`context.locals.user` → 401, `createClient` → 500, `context.params.id` → 400, zod-validated `{ question: string }`
body, load-before-act ownership check on `sessions` with defense-in-depth `.eq("session_id", …)`).
Persist order: insert user-turn row (next `position`) **before** the LLM call; insert assistant-turn row
**after** the stream completes. Returns a streamed `text/event-stream` body or a buffered `json({ answer })`
per the Phase 1 decision. Handle missing/`NULL` `extracted_text` by returning a clear "no material to
ground against" response without an LLM call.

#### 3. Unit + integration tests

**File**: `src/lib/services/qa/answer.test.ts` (new) and `src/pages/api/sessions/[id]/ask.integration.test.ts` (new)

**Intent**: Test message-shaping (source injection, prior-turn inclusion, refusal instruction) at the
unit level, and the endpoint's persist-ordering + RLS-scoped behavior at the integration level using the
existing OpenRouter stub.

**Contract**: Unit asserts `buildQaMessages` output structure; integration mirrors
`complete.integration.test.ts` / `exercises/[exerciseId].integration.test.ts` and the
`src/test/generation/openrouter-mock.ts` stub, asserting a user turn is written before and an assistant
turn after a stubbed answer, and that a cross-session/cross-user request is rejected.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Integration tests pass: `npm test` (integration suite)
- Type checking passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- `curl`/devtools POST to the ask endpoint streams (or returns) a grounded answer.
- A user-turn row exists in `conversation_messages` even if the answer is interrupted; the assistant-turn
  row appears only on completion.
- An off-source question yields the on-source refusal.

**Implementation Note**: Pause for manual confirmation of streaming/persistence behavior before the UI phase.

---

## Phase 4: AskTutorPanel UI + SSR history load

### Overview

Render the always-visible chat panel in the session view, load prior turns server-side, and consume the
streamed answer with graceful handling of unanswered turns.

### Changes Required:

#### 1. AskTutorPanel component

**File**: `src/components/session/AskTutorPanel.tsx` (new)

**Intent**: A self-contained chat panel — transcript of prior turns, textarea + Send (Enter-to-send),
streaming consumer that appends tokens as they arrive — mirroring the `OnboardingChat.tsx` bubble UI but
with a per-message streaming fetch. Renders an unanswered user turn (aborted/interrupted) without erroring.

**Contract**: Props `{ sessionId: string; initialTurns: ConversationMessageView[] }`. Streaming consumer
uses browser-native `fetch(...).body.getReader()` (no new deps; keeps the SSR module graph clean per
[[lessons.md]]). Tailwind styling matches the existing panel idiom
(`rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl`).

#### 2. Mount in SessionRunner

**File**: `src/components/session/SessionRunner.tsx`

**Intent**: Add the panel as a new full-width `<section>` below the theory/exercise grid so it's available
during theory, exercises, and after scoring, with zero coupling to answer/score state.

**Contract**: Render `<AskTutorPanel sessionId={sessionId} initialTurns={...} />` after the grid
(around `:520`); add an `initialTurns` prop to `SessionRunner`'s `Props` and thread it through.

#### 3. SSR load of prior turns

**File**: `src/pages/sessions/[id].astro`

**Intent**: Load the current session's conversation turns (RLS-scoped) and pass them to the island so a
reload restores the transcript.

**Contract**: Add a `from("conversation_messages").select(...).eq("session_id", id).order("position")`
query following the existing RLS-scoped load pattern; map rows to the view type and pass as `initialTurns`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Panel is visible and usable during theory, during exercises, and after the session is scored.
- Asking a question streams the answer token-by-token into the transcript.
- Reloading the page restores the full transcript, including any unanswered question.
- An off-source question shows the refusal in the panel.

**Implementation Note**: Pause for manual confirmation of the end-to-end UX before the final phase.

---

## Phase 5: Grounding eval + final verification

### Overview

Add an opt-in grounding eval over Q&A fixtures (the wedge guard) and run the full regression sweep.

### Changes Required:

#### 1. Q&A grounding eval

**File**: `src/test/grounding/qa.livejudge.test.ts` (new) + fixtures under `src/test/grounding/`

**Intent**: Reuse the grounding-judge approach to verify that `answerQuestion` outputs stay entailed by
the source for a set of hand-authored question/source fixtures, with the fixture's PASS/FLAG label as the
oracle (never the model's own output). Opt-in like `judge.livejudge.test.ts` (excluded from `npm test`).

**Contract**: A `test:livejudge`-style suite that runs `answerQuestion` against fixtures and asserts
grounding via the judge; requires a real key; not part of the default `npm test`.

#### 2. Full regression sweep

**File**: — (verification only)

**Intent**: Confirm no regressions across the existing suites and build.

**Contract**: `npm run lint`, `npm run build`, `npx supabase test db`, `npm test` all green.

### Success Criteria:

#### Automated Verification:

- Full unit + integration suite passes: `npm test`
- RLS isolation tests pass: `npx supabase test db`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Opt-in Q&A grounding eval (`npm run test:livejudge` equivalent) passes against fixtures with a real key.
- Spot-check: a question whose answer is genuinely in the source is answered; an off-source question is refused.

**Implementation Note**: Final phase — confirm the grounding eval and full regression before archiving.

---

## Testing Strategy

### Unit Tests:

- `buildQaMessages` shapes the grounding system prompt, concatenated capped source, bounded prior turns,
  and the question correctly; refusal instruction present.
- Source concatenation across multiple `materials` rows respects the char cap.

### Integration Tests:

- Ask endpoint: user turn persisted before the LLM call, assistant turn after completion (via OpenRouter stub).
- Ownership: cross-user / cross-session ask requests are rejected by RLS + defense-in-depth.
- Missing/`NULL` `extracted_text` is handled without an LLM call.

### Manual Testing Steps:

1. Start a session, ask a source-answerable question → streamed grounded answer.
2. Ask an off-source question → on-source refusal inviting rephrasing.
3. Interrupt a streaming answer → user turn persists, no assistant turn; reload renders the unanswered question.
4. Reload mid-session → full transcript restored.
5. Use the panel during theory, during exercises, and after scoring.

## Performance Considerations

- Source is capped (reuse 60k convention) and prior-turn context is bounded to keep token cost and latency
  predictable as a conversation grows.
- Streaming improves perceived latency; the buffered fallback (if selected in Phase 1) keeps a single
  round-trip per question.
- No live grounding judge in the request path (latency/cost) — grounding is prompt-enforced + offline-verified.

## Migration Notes

- One additive migration (`conversation_messages`); no changes to existing tables. `extracted_text` is
  nullable with no backfill, so the endpoint must tolerate sessions without source text.
- Cascade deletes on `session_id`/`user_id` keep the table consistent with S-07 (delete session) and
  account deletion without extra cleanup code.

## References

- Related research: `context/changes/ask-tutor-mid-session/research.md`
- Grounding prompt to reuse: `src/lib/services/generation/generate.ts:54-96`
- OpenRouter client: `src/lib/services/generation/openrouter.ts:21-34`
- RLS template: `docs/reference/rls-policy-template.md`
- Canonical route: `src/pages/api/sessions/[id]/complete.ts:1-63`
- Closest UI analog: `src/components/onboarding/OnboardingChat.tsx`
- In-session island: `src/components/session/SessionRunner.tsx:407,520`
- Grounding judge (offline eval model): `src/lib/services/grounding/judge.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Streaming spike + transport decision

#### Automated

- [x] 1.1 Type checking passes: `npm run lint` — 161c57d
- [x] 1.2 Production build succeeds with the probe present: `npm run build` — 161c57d

#### Manual

- [x] 1.3 Probe delivers chunks incrementally under `npm run dev` — 161c57d
- [x] 1.4 Streaming behaves the same under `npm run preview` (or buffered fallback selected) — 161c57d
- [x] 1.5 OpenAI-SDK `stream: true` yields incremental deltas through OpenRouter — 161c57d
- [x] 1.6 Transport decision recorded; `src/pages/api/_spike/` removed — 161c57d

### Phase 2: conversation_messages table + RLS + isolation

#### Automated

- [x] 2.1 RLS isolation tests pass: `npx supabase test db` — 0f12f8b
- [x] 2.2 Type checking passes: `npm run lint` — 0f12f8b
- [x] 2.3 Build succeeds: `npm run build` — 0f12f8b

#### Manual

- [x] 2.4 Migration applies cleanly against local Supabase — 0f12f8b
- [x] 2.5 `database.types.ts` shows the table; `types.ts` exports `ConversationMessage` — 0f12f8b

### Phase 3: Grounded Q&A service + ask endpoint + persistence

#### Automated

- [x] 3.1 Unit tests pass: `npm test` — 2632731
- [x] 3.2 Integration tests pass: `npm test` (integration suite) — 2632731
- [x] 3.3 Type checking passes: `npm run lint` — 2632731
- [x] 3.4 Build succeeds: `npm run build` — 2632731

#### Manual

- [x] 3.5 POST to ask endpoint streams/returns a grounded answer — 2632731
- [x] 3.6 User turn persists on interruption; assistant turn only on completion — 2632731
- [x] 3.7 Off-source question yields the on-source refusal — 2632731

### Phase 4: AskTutorPanel UI + SSR history load

#### Automated

- [x] 4.1 Type checking passes: `npm run lint` — 435a091
- [x] 4.2 Build succeeds: `npm run build` — 435a091

#### Manual

- [x] 4.3 Panel usable during theory, exercises, and after scoring — 435a091
- [x] 4.4 Asking streams the answer token-by-token — 435a091
- [x] 4.5 Reload restores the full transcript, including unanswered questions — 435a091
- [x] 4.6 Off-source question shows the refusal in the panel — 435a091

### Phase 5: Grounding eval + final verification

#### Automated

- [ ] 5.1 Full unit + integration suite passes: `npm test`
- [ ] 5.2 RLS isolation tests pass: `npx supabase test db`
- [ ] 5.3 Lint passes: `npm run lint`
- [ ] 5.4 Build succeeds: `npm run build`

#### Manual

- [ ] 5.5 Opt-in Q&A grounding eval passes against fixtures with a real key
- [ ] 5.6 Spot-check: source-answerable question answered; off-source refused
