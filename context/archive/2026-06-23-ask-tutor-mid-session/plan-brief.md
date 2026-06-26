# Ask the Tutor Mid-Session (S-05) — Plan Brief

> Full plan: `context/changes/ask-tutor-mid-session/plan.md`
> Research: `context/changes/ask-tutor-mid-session/research.md`

## What & Why

Add an in-session "ask the tutor" chat panel so a learner can ask free-form questions about their
uploaded material at any point in a session (FR-008). Answers must stay **grounded only in the source
files** — that grounding is the product wedge; a generic chat answer erodes it.

## Starting Point

The session loop (upload → grounded theory + exercises → score) ships today. The full extracted source
text already lives in `materials.extracted_text` under per-learner RLS — S-01 provisioned it explicitly
"so S-05 can reuse it." A reusable grounding system-prompt exists in `generate.ts`. But there is **no**
streaming anywhere (every LLM call is buffered) and **no** conversation table (the S-02 intake and S-03
onboarding "chats" are non-persisted).

## Desired End State

On `/sessions/[id]`, an always-visible panel below the theory/exercise grid lets the learner ask
questions during theory, during exercises, and after scoring. Answers stream token-by-token and stay
on-source (off-source questions get a refusal that invites rephrasing). Every turn is persisted under
RLS; a reload restores the transcript. A cross-account learner can't read another's turns.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Response delivery | Streaming (SSE) | Token-by-token UX for a chat feel | Research (scope) |
| Streaming risk | Spike first, buffered fallback | Workers streaming is unproven — de-risk before UI | Plan |
| Turn persistence | Persist turns (new table) | S-06 history needs replayable data | Research (scope) |
| Persist timing | User turn pre-call, assistant on completion | Never lose the question; never store partial answers | Plan |
| Grounding context | Source + prior turns (bounded) | Follow-ups work while staying source-grounded | Plan |
| Off-source handling | Refuse on-source, suggest rephrasing | Protects the wedge the roadmap flags for S-05 | Plan |
| Multi-material | Concatenate all materials, capped | Matches "my material"; reuses 60k cap convention | Plan |
| Panel UX | Always-visible below the grid, available throughout | Delivers FR-008 "at any point", zero state coupling | Plan |
| Testing | Unit + integration + RLS isolation + opt-in judge eval | Matches existing test layers; guards grounding offline | Plan |
| Out of scope | History-replay UI, turn edit/delete, live per-turn judge | Keeps the slice to the FR-008 wedge | Plan |

## Scope

**In scope:** ask endpoint, streamed grounded answers, `conversation_messages` table + RLS + isolation
test, AskTutorPanel UI, SSR load of current-session turns, opt-in Q&A grounding eval.

**Out of scope:** rendering past sessions' conversations (S-06), editing/deleting turns, live per-turn
grounding judge, off-source/general answering, new upload/parse work.

## Architecture / Approach

New `POST api/sessions/[id]/ask.ts` fetches RLS-scoped source (`materials.extracted_text`, concatenated +
capped) and prior turns, persists the user turn, calls a new `answerQuestion` service (grounding prompt
reused from generation, **plain-text** stream — not JSON mode), streams the answer back, then persists the
assistant turn on completion. A self-contained `AskTutorPanel` island consumes the stream via browser-native
`fetch().body.getReader()`. The grounding judge stays an **offline** eval — it can't judge a token stream.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Streaming spike | Proven transport (SSE) or buffered fallback decision | Workers/workerd may buffer the stream — the core unknown |
| 2. Data model | `conversation_messages` table + RLS + isolation test + types | RLS isolation must be airtight |
| 3. Service + endpoint | `answerQuestion` + ask route + persistence + tests | Persist ordering on aborted streams |
| 4. UI | AskTutorPanel + SSR transcript load | Streaming consumer + graceful unanswered turns |
| 5. Grounding eval | Opt-in Q&A grounding eval + regression sweep | Answers drifting off-source |

**Prerequisites:** S-01 done (source text + generation grounding in place); local Supabase for migration + `supabase test db`; OpenRouter key for the opt-in eval.
**Estimated effort:** ~4–5 sessions across 5 phases (Phase 1 is short but gates the rest).

## Open Risks & Assumptions

- Cloudflare Workers streaming is unproven in this repo — Phase 1 exists to resolve it before UI work; buffered fallback keeps the feature shippable.
- Grounding rests on the prompt + source-only context (no live judge); the offline eval is the guard.
- `extracted_text` is nullable with no backfill — the endpoint must tolerate sessions with no source text.

## Success Criteria (Summary)

- A learner asks a question mid-session and gets a streamed answer grounded in their material.
- Off-source questions are refused on-source; turns persist and survive a reload.
- A cross-account learner cannot read another learner's turns (`supabase test db` green).
