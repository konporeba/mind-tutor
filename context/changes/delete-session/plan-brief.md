# Delete Session (S-07) — Plan Brief

> Full plan: `context/changes/delete-session/plan.md`

## What & Why

Let a learner hard-delete one of their sessions from the dashboard history, after an explicit confirmation. Implements roadmap **S-07** / PRD **US-03, FR-016**: the session and all its data — uploaded file, generated theory/exercises, score, and conversation log — are removed and no longer retrievable through any product surface. This covers the MVP privacy-delete case (full account deletion is a v2 non-goal).

## Starting Point

The schema was built for this: every child table cascades on `session_id`, and `sessions` already has a `sessions_delete_own` RLS policy — so deleting the session row wipes all DB rows with no migration. The create path's rollback already demonstrates both `sessions.delete()` and Storage `remove()`. History is the dashboard's "Your sessions" list, currently pure server-rendered Astro markup with no React island and no delete affordance.

## Desired End State

A delete button on each dashboard session row opens an accessible confirm dialog; confirming removes the session everywhere — the row vanishes from the list in place (no reload), the old `/sessions/[id]` becomes unreachable, and the uploaded file is gone from Storage. Other sessions, profile, and account are untouched.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Placement | Dashboard history list only | Matches PRD "delete from history"; one surface to build/test. | Plan |
| Confirmation | Custom accessible confirm dialog (island) | Keyboard/focus-accessible and on-brand vs. unstyled native `confirm()`. | Plan |
| Endpoint shape | `DELETE /api/sessions/[id]` | RESTful verb beside `complete.ts`/`ask.ts` in the same `[id]/` route folder. | Plan |
| Storage vs cascade order | Collect paths → remove Storage → delete row; abort on Storage failure | No orphaned objects on success; nothing half-deleted on failure. | Plan |
| Deletable statuses | Any of the learner's sessions | Simplest rule; lets junk/abandoned sessions be removed too. | Plan |
| Post-delete UX | Optimistic in-place row removal | Fast, no reload flash; the list island owns row visibility. | Plan |
| Testing depth | Integration tests via RLS harness | Covers the irreversible-cascade + isolation risk; matches existing pattern. | Plan |

## Scope

**In scope:** `DELETE /api/sessions/[id]` endpoint; Storage cleanup; `SessionHistoryList` React island with per-row delete + confirm dialog; dashboard wiring; integration tests; roadmap S-07 close-out.

**Out of scope:** soft-delete/undo, delete on the detail page, account deletion, bulk delete, any new migration, Playwright E2E.

## Architecture / Approach

`dashboard.astro` keeps its SSR read of `listSessions()` but renders a new `SessionHistoryList` island (`client:load`) with the sessions as a prop. The island owns the list state and a native `<dialog>`-based confirm modal; on confirm it calls `DELETE /api/sessions/[id]` and drops the row from state on success. The endpoint reads material `storage_path`s, removes the Storage objects, then deletes the session row — letting the DB cascade clear `materials`, `generated_content`, `exercises`, and `conversation_messages`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Delete API endpoint | `DELETE /api/sessions/[id]` with Storage-then-cascade delete + RLS-harness integration tests | Storage/row ordering must be airtight — paths read before the cascade removes material rows |
| 2. Dashboard delete UI | `SessionHistoryList` island + accessible confirm dialog + optimistic removal; roadmap close-out | Extracting the list to a React island without regressing the existing row UI/empty state |

**Prerequisites:** S-06 (done). Local Supabase running for integration tests.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- Hard-delete is irreversible (by design); the confirm dialog is the only guard.
- Storage removal is best validated against the local Supabase stack; a rare Storage outage blocks delete (intentional — abort over orphan).
- Assumes one-file-per-session in practice, but the endpoint removes all material paths it finds, so multi-file is handled.

## Success Criteria (Summary)

- A learner deletes a session from the dashboard after confirming, and it disappears from the list without a reload.
- The session, its child data, and its Storage file are gone from every product surface; other sessions remain intact.
- Integration tests prove the cascade clears all child rows and that a non-owner cannot delete another learner's session.
