# Session History View (S-06) — Plan Brief

> Full plan: `context/changes/session-history-view/plan.md`

## What & Why

Let a learner find and revisit a past session. Sessions are fully persisted (S-01) and the detail
page already replays theory/exercises/score, but there's **no list to discover them** and the detail
view shows neither the **uploaded file** nor the **conversation log**. This slice adds the dashboard
history list plus file download and a read-only conversation transcript — completing the read half of
FR-014.

## Starting Point

`sessions` and child tables (`materials`, `generated_content`, `exercises`, `conversation_messages`)
all persist under per-learner RLS. `/sessions/[id]` loads a session via `.single()` (RLS gate) and
replays it; for completed sessions it's effectively read-only already. The dashboard is just a static
welcome card with no list. S-05's *live* ask-tutor panel is mid-flight on this branch but not merged.

## Desired End State

The dashboard lists the learner's sessions newest-first (title, score, status badge, date), each
linking to its detail view. Opening a session adds, to the existing replay, a downloadable copy of
the uploaded file and — for completed sessions — a read-only Q&A transcript. No learner can list or
open another's data, proven through real RLS.

## Key Decisions Made

| Decision               | Choice                                            | Why (1 sentence)                                                            | Source |
| ---------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- | ------ |
| History list placement | On the dashboard                                  | Single landing surface, fewest clicks to the entry point.                   | Plan   |
| Which sessions listed  | All, with status badges (active rows = "Resume")  | Nothing is stranded; active rows resume the existing runner (no new logic). | Plan   |
| Uploaded file display  | Download via Storage signed URL                   | Truly lets the learner "revisit its uploaded files" (the outcome wording). | Plan   |
| Conversation rendering | S-06's own read-only render                        | Decouples from S-05's in-flight live panel; works whether or not it merged.| Plan   |
| Read-only semantics    | Completed = read-only transcript (no asking)      | History stays an immutable record; revisiting can't mutate a finished run.  | Plan   |
| Row content / order    | Title, score, status, date — newest first          | Scannable; surfaces the score (the product's readiness signal).            | Plan   |
| RLS verification       | Cross-account integration read test (+ DB)        | Exercises the flagged risk through the app's read path, not just the DB.    | Plan   |

## Scope

**In scope:** dashboard history list; detail-view file download (signed URL); read-only conversation
transcript for completed sessions; cross-account RLS read test.

**Out of scope:** posting new questions (S-05); delete/edit (S-07); pagination/search/filter;
mid-session resume logic; schema/type changes (all tables + `ConversationMessage` type already exist).

## Architecture / Approach

New read queries are extracted into small client-taking helpers under `src/lib/services/history/`
(`listSessions`, `loadSessionMaterials`, `loadConversation`) so the SSR read path is testable through
the existing two-identity RLS harness; the detail page's pre-existing inline theory/exercise loads are
left untouched. Read-only sections render as static Astro markup/components (no React island). The
transcript renders only when `status === "completed"`, leaving active sessions to S-05's live panel —
so the two slices coexist on `/sessions/[id]` without double-rendering.

## Phases at a Glance

| Phase                                       | What it delivers                                            | Key risk                                                  |
| ------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| 1. Dashboard history list                   | `listSessions` helper + dashboard rows + empty state       | List query must stay RLS-scoped (no cross-account leak)  |
| 2. Detail: files + read-only conversation   | Signed-URL download + read-only transcript (completed)     | Signed-URL/`NULL` path handling; S-05 page coexistence   |
| 3. Cross-account RLS verification + sweep    | Two-identity read test + DB isolation + full regression    | Test must prove app-path isolation, not just the policy  |

**Prerequisites:** S-01 (done); `conversation_messages` table (done, commit `0f12f8b`). No migration.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- S-05 and S-06 both edit `src/pages/sessions/[id].astro` and read `conversation_messages`; gating
  S-06's transcript on `status === "completed"` is the agreed coexistence rule, but a merge-order
  reconciliation may still be needed when S-05's live panel lands.
- `createSignedUrl` TTL is short by design — a stale link just needs a page refresh.
- `createSessionGraph` seeds an active session with no conversation turn, so the Phase 3 test sets
  status / inserts a turn explicitly.

## Success Criteria (Summary)

- A learner can find a past session from the dashboard and open it.
- A completed session shows a downloadable file and a read-only Q&A transcript.
- No learner can list or open another learner's session/materials/conversation (proven by test).
