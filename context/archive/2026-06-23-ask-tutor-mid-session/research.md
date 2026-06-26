---
date: 2026-06-23T19:18:49+0200
researcher: porebkon
git_commit: 2e395210441aafb406493c28711b9a440e6b9b6a
branch: test/e2e-openrouter-stub
repository: MindTutor
topic: "S-05 ask-tutor-mid-session — in-session grounded Q&A chat (streaming + persisted turns)"
tags: [research, codebase, ask-tutor, streaming, grounding, rls, session-runner]
status: complete
last_updated: 2026-06-23
last_updated_by: porebkon
---

# Research: S-05 Ask the tutor mid-session

**Date**: 2026-06-23T19:18:49+0200
**Researcher**: porebkon
**Git Commit**: 2e395210441aafb406493c28711b9a440e6b9b6a
**Branch**: test/e2e-openrouter-stub
**Repository**: MindTutor

## Research Question

How should S-05 (`ask-tutor-mid-session`) be built — an in-session chat panel where a
learner asks free-form questions about their uploaded material and gets answers grounded
only in the source files? Scope decisions locked before research: **streaming (SSE)**
response delivery, and **persisted** conversation turns (so S-06 history can replay them).

## Summary

S-05 is buildable by reusing three existing seams and adding two net-new pieces:

**Reuse (already in place):**
1. **Source text is ready and queryable** — the full extracted material text lives in
   `materials.extracted_text`, keyed by `session_id` under per-learner RLS. The S-01
   migration comment literally names S-05 as the future consumer of this column. A Q&A
   turn grounds against this; no file re-parsing needed.
2. **The grounding *prompt pattern*** — `buildMessages()` in `generate.ts` has the exact
   "use ONLY facts present in the source" system-prompt language and the `"""`-fenced
   source-injection shape to copy. (Do NOT reuse the session-sizing/JSON-schema machinery
   — that shapes theory/exercise *structure*, irrelevant to free-form prose answers.)
3. **The OpenRouter client + canonical API-route + chat-UI scaffolding** — `getOpenRouterClient()`
   / `getModel()`, the `complete.ts` route template, and the `OnboardingChat.tsx` chat-bubble
   UI are all directly mirrorable.

**Net-new (the real work + risk):**
1. **Streaming infrastructure** — there is **zero** streaming/SSE anywhere in the codebase.
   Every LLM call is buffered (`chat.completions.create` with no `stream: true`) and every
   API route returns a fully-buffered `new Response(JSON.stringify(...))`. The OpenAI SDK
   supports `stream: true` and Astro-on-Workers *can* return a `ReadableStream` body, but
   this is **unproven in this repo** — it is the load-bearing technical risk to validate
   early (matches the `infrastructure.md` Workers-streaming caution).
2. **A `conversation_messages` table** — no conversation/chat/messages table exists today.
   Both existing "chats" (S-02 intake, S-03 onboarding) are non-persisted: intake is three
   typed columns on `sessions`; onboarding is client-state distilled to `profiles.bio` and
   discarded. Persisting Q&A turns is greenfield — a new migration following the F-01
   four-policy per-learner RLS template.

## Detailed Findings

### Area 1 — OpenRouter client + generation grounding

- **Client** (`src/lib/services/generation/openrouter.ts:21-34`): thin wrapper over the
  official OpenAI SDK (`openai ^6.42.0`) pointed at `https://openrouter.ai/api/v1`.
  `getOpenRouterClient()` throws `GenerationError` if `OPENROUTER_API_KEY` is unset;
  `getModel()` returns `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`, `astro.config.mjs:22-27`).
  No timeout/retry configured at the client; app-level retry is in `generate.ts` (`MAX_ATTEMPTS = 2`).
- **Streaming: not supported today.** The only call site (`generate.ts:150-157`) is a
  blocking buffered completion with `response_format: { type: "json_object" }`,
  `temperature: 0.3`, `max_tokens: 4000`, no `stream: true`. The client wrapper needs **no
  change** to stream — a new call site passes `stream: true` and iterates deltas. But JSON
  mode and streaming are in tension: a prose Q&A answer should **drop JSON mode and stream
  plain text**, making this a parallel code path, not a tweak to `generateSession`.
- **Grounding prompt** (`generate.ts:54-96`, `buildMessages`): pure function.
  - System message (`:71-88`) opens with the grounding contract: *"Use ONLY facts present
    in the source. Never introduce outside knowledge or invent details."*
  - Source injected in the **user** message, fenced: `SOURCE MATERIAL:\n"""\n${sourceText}\n"""` (`:90`).
  - `MAX_SOURCE_CHARS = 60_000` (`:18`); text is `.slice(0, MAX_SOURCE_CHARS)` (`:133`).
  - Intake (S-02) injected via a `tailoring` block (`:57-62`); bio (S-03) appended only when
    non-empty, scoped to "tone and framing only" (`:64-69`).
- **Grounding discipline is two-layer** (load-bearing): structural `findUngroundedCitation`
  substring check (`:100-109`) + retry loop (`:147-191`). This is citation-based and tied to
  the generated session's `theory[].citation` fields — **not directly reusable** for a prose
  answer, but the *prompt language* is.

### Area 2 — Grounding judge (reuse candidate, with caveats)

- `judgeGrounding(session, source)` (`src/lib/services/grounding/judge.ts:121-169`): one live
  model call (temp 0, JSON mode) that decomposes prose into atomic claims and flags any not
  entailed by the source. Returns `{ claims, ungrounded, allGrounded }`.
- **TEST-ONLY by design.** Header comment (`judge.ts:11-14`): "Deliberately NOT wired into the
  production generation path; this is a test-layer asset … tree-shaken out of the worker
  bundle." Only caller is `judge.livejudge.test.ts` (`npm run test:livejudge`, real key).
- **Reuse for Q&A is possible but adapted**: it already uses the same OpenRouter seam and 60k
  slice, but its field taxonomy is hardcoded to session surfaces (`grounding/schema.ts:16-23`,
  `GROUNDING_FIELDS = title | theory.* | mcq.*`) and `buildGroundingClaims` only reads a
  `GeneratedSession`. A Q&A answer would need a new field (e.g. `qa.answer`) or a thinner entry
  point taking raw answer text. **Tension with streaming**: the judge is a post-hoc blocking
  full-text verifier — it cannot judge tokens mid-stream, and adding it live doubles per-turn
  latency/cost. Best kept as an eval/test gate, not a live per-turn guard.

### Area 3 — Source text availability (the grounding corpus)

- **`materials.extracted_text` (text, nullable)** — `database.types.ts:128`, created in
  `supabase/migrations/20260607150000_first_grounded_session.sql:21`. Migration comment
  (`:6-9`): persists browser-parsed text "so the server can ground generation and validate
  citations without re-parsing the original file (**and so S-05 can reuse it later**)."
- Written at session creation: `api/sessions/index.ts:159` inserts `extracted_text`.
- Retrieval for a Q&A turn: `supabase.from("materials").select("extracted_text").eq("session_id", …)`
  — RLS scopes to the owner automatically.
- **Caveats**: nullable with no backfill → handle missing-text sessions (disable/degrade chat);
  multiple `materials` rows per session possible (no uniqueness on `session_id`) → decide
  concatenate-all vs pick-one; the 60k cap lives only in `generate.ts`/`judge.ts`, DB holds full text.

### Area 4 — Domain data model + conversation persistence

- Five domain tables, each with denormalized `user_id` (RLS owner) and (except `profiles`) a
  `session_id` FK with `on delete cascade`:
  - `sessions` (`database.types.ts:193-234`) — root; `status`, `score`, `title`, intake columns
    `knowledge_level`/`learning_goal`/`time_budget_minutes`.
  - `materials` (`:125-168`) — `extracted_text`, `storage_path`, file metadata.
  - `generated_content` (`:87-124`) — `kind` (`theory|exercise`), `position`, `body` jsonb.
  - `exercises` (`:31-86`) — `kind` (`mcq|fill_blank|matching`), `position`, `prompt`, `options`,
    `correct_answer`, `learner_answer`, `is_correct`, `feedback`.
  - `profiles` (`:169-192`) — PK = `user_id`, `bio`, `onboarded_at`.
- **No conversation/messages/chat table exists** — not in types, not in migrations. Both existing
  "chats" are non-persisted:
  - Onboarding (S-03): client React state (`OnboardingChat.tsx:8-17`) → POST raw answers →
    distilled to `profiles.bio`, turns discarded (`api/onboarding/index.ts:55-59`).
  - Intake (S-02): three typed form values → columns on `sessions` (`api/sessions/index.ts:131-133`).
  - ⇒ Persisting Q&A turns is **greenfield**; build a new table.

### Area 5 — In-session island + API route patterns

- **`SessionRunner.tsx`** — one `client:load` island (default export at `:276`) with pure
  sub-components `McqQuestion`/`FillBlankQuestion`/`MatchingQuestion` in-file. Props (`:52-59`):
  `sessionId`, `title`, `initialStatus`, `initialScore`, `theory[]`, `exercises[]`. No phase
  machine — theory + exercises render side-by-side in a `lg:grid-cols-2` grid (`:407`); state in
  hooks (`:293-300`). Network via plain `fetch` (`:308`, `:337`).
  - **Chat extension point**: a self-contained `<AskTutorPanel sessionId={sessionId} />` —
    cleanest as a new `<section>` between the completed banner (`:405`) and the grid (`:407`),
    or after the grid (`:520`). It owns its own state and adds zero coupling to answer/score state.
- **`sessions/[id].astro`** — SSR frontmatter (`:1-101`): `createClient` (`:14`), ownership via
  **RLS only** (`from("sessions").select(...).eq("id", id).single()` `:21-25`, redirect on error),
  loads theory + exercises, hydrates island (`:105-113`). New conversation history would be
  loaded here with the same RLS pattern and passed as an extra prop.
- **Canonical API route** (`api/sessions/[id]/complete.ts:1-63`): `export const prerender = false`,
  local `json()` helper, uppercase `POST: APIRoute`, `context.locals.user` → 401, `createClient` →
  500, `context.params.id` → 400, zod `safeParse`, RLS queries + defense-in-depth `.eq("session_id", …)`
  + load-before-act. **New endpoint belongs at `api/sessions/[id]/ask.ts`.**
- **Onboarding chat analog**: request/response single-shot, NOT streaming, scripted questions —
  reuse its **chat-bubble UI scaffolding only**; replace the one-shot fetch with a per-message
  streaming fetch.
- **Streaming: none exists** — searches for `ReadableStream`/`text/event-stream`/`TransformStream`/
  `EventSource`/`getReader` return zero source matches. Net-new infrastructure.

## Code References

- `src/lib/services/generation/openrouter.ts:21-34` — OpenRouter client; reuse `getOpenRouterClient()`/`getModel()`.
- `src/lib/services/generation/generate.ts:54-96` — `buildMessages`: grounding system prompt + `"""`-fenced source injection (copy this).
- `src/lib/services/generation/generate.ts:150-157` — the only LLM call site; buffered, JSON mode, no streaming.
- `src/lib/services/grounding/judge.ts:11-14,121-169` — test-only grounding verifier; reuse candidate for an eval gate, not a live per-turn guard.
- `src/db/database.types.ts:125-168` — `materials` incl. `extracted_text` (the grounding corpus).
- `supabase/migrations/20260607150000_first_grounded_session.sql:6-9,21` — `materials.extracted_text`; comment names S-05 as consumer.
- `supabase/migrations/20260528202720_domain_schema_rls_baseline.sql:36-50` — canonical four-policy RLS block (the F-01 template).
- `docs/reference/rls-policy-template.md` — RLS template + required post-migration steps (rls_isolation_test.sql, gen types, types.ts re-export).
- `src/components/session/SessionRunner.tsx:52-59,405-407,520` — island props + chat-panel extension point.
- `src/pages/sessions/[id].astro:21-25,105-113` — RLS-scoped load + island hydration.
- `src/pages/api/sessions/[id]/complete.ts:1-63` — canonical route template; new endpoint → `[id]/ask.ts`.
- `src/pages/api/sessions/[id]/exercises/[exerciseId].ts:43-54,98-99` — defense-in-depth `.eq("session_id", …)` + load-before-act.
- `src/components/onboarding/OnboardingChat.tsx:8-46` + `src/pages/api/onboarding/index.ts:55-66` — closest UI analog (one-shot, non-streaming).

## Architecture Insights

- **Grounding is the wedge** — the prompt-level "no off-source claims" discipline (`generate.ts:71-88`)
  is the single most important pattern to carry into Q&A. The generator enforces it structurally via
  citations; a prose Q&A answer can't be citation-checked the same way, so grounding strength rests on
  (a) the system-prompt language + (b) feeding `materials.extracted_text` as the only knowledge source,
  with the judge available as an offline eval gate.
- **RLS-only ownership + defense-in-depth** — pages/routes lean on RLS for ownership and add an explicit
  `.eq("session_id", …)` "load-before-act" so cross-account targets 404 before leaking. The Q&A endpoint
  and the new table must follow both.
- **Lazy-import / SSR-bundle discipline** ([[lessons.md]]: "Lazy-import browser-only libraries in SSR'd
  islands") — the chat panel is a `client:load` island; keep any browser-only deps out of the top-level
  module graph. Streaming consumption (`fetch().body.getReader()`) is browser-native and fine.
- **Two net-new risks to validate in the plan**: (1) Workers can stream a `ReadableStream`/`text/event-stream`
  body through `@astrojs/cloudflare` (unproven here, flagged in `infrastructure.md`); (2) the new
  `conversation_messages` table must pass `rls_isolation_test.sql` cross-account isolation before shipping.

## Historical Context (from prior changes)

- `supabase/migrations/20260607150000_first_grounded_session.sql` (S-01) — explicitly provisioned
  `materials.extracted_text` "so S-05 can reuse it later." S-05 is the named beneficiary.
- `context/archive/2026-06-08-per-session-intake-tailoring/` (S-02) — intake stored as typed columns,
  not conversation rows; precedent that "chat-shaped" capture need not imply a messages table.
- `context/archive/2026-06-09-onboarding-bio-tailoring/` (S-03) — onboarding conversation distilled to
  `profiles.bio` and discarded; confirms no existing turn-level persistence to extend.
- `context/archive/2026-06-14-multi-type-exercises/` (S-04) — `exercises.kind` CHECK precedent for a
  constrained `role`/`kind` text column (mirror for `conversation_messages.role`).

## Suggested new table (from the established convention)

A new migration `supabase/migrations/<timestamp>_conversation_messages.sql` following the F-01 template
verbatim (denormalized `user_id`, `session_id` FK cascade, `user_id`/`session_id` indexes, four-policy
RLS block, `role` CHECK in `('user','assistant')`, `position int`, `content text`, append-only / no
`updated_at`). Optionally a `grounding`/`sources` jsonb column to record which source spans grounded an
answer for the S-06 history view. Post-migration: extend `supabase/tests/rls_isolation_test.sql`
(bump `plan(N)`), `npx supabase test db`, regenerate `database.types.ts`, re-export a
`ConversationMessage` type from `src/types.ts`. (Full sketch produced during research — hand to `/10x-plan`.)

## Open Questions

- **Streaming on Workers**: does `@astrojs/cloudflare` reliably stream a `text/event-stream` /
  `ReadableStream` body in this app's deploy target? Prove with a spike before committing the UX. If it
  doesn't, fall back to buffered request/response (the plan should carry this contingency).
- **Persist timing**: write the user turn before the LLM call and the assistant turn after stream
  completion? How are partial/aborted streams persisted (or not)?
- **Multi-material sessions**: concatenate all `materials.extracted_text` rows for the session, or
  scope to one? Affects the 60k cap budget.
- **Grounding verification depth**: prompt-only, or add an offline judge eval over Q&A fixtures? No live
  per-turn judge (latency/cost + can't judge a stream).
- **Conversation scope for grounding**: include prior Q&A turns in the prompt context, or each question
  standalone against source? Affects token budget and "stays grounded" guarantees.

## Related Research

- None prior for this change. First research artifact for `ask-tutor-mid-session`.
