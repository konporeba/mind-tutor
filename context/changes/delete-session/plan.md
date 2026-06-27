# Delete Session (S-07) Implementation Plan

## Overview

Let a learner hard-delete one of their sessions from the dashboard history list after an explicit confirmation. Deleting removes everything tied to that session — the uploaded file in Storage, the session row, and (via DB cascade) its materials, generated theory, exercises, score, and conversation log — so the session is no longer retrievable through any product surface. Implements roadmap **S-07** (PRD **US-03 / FR-016**).

## Current State Analysis

- **The DB cascade already exists.** `sessions` is the aggregate root; every child table (`materials`, `generated_content`, `exercises`, `conversation_messages`) declares `session_id ... references public.sessions (id) on delete cascade`. The baseline migration's header explicitly notes "session-level cascade is what S-07 (delete session) relies on for row cleanup" (`supabase/migrations/20260528202720_domain_schema_rls_baseline.sql:13-14`). Deleting the session row clears all child rows with no extra DELETE statements.
- **The delete RLS policy already exists.** `sessions_delete_own` allows `delete to authenticated using (user_id = (select auth.uid()))` (migration `:49-50`). A non-owner's delete affects zero rows; an owner's delete is scoped automatically. No new migration is required.
- **Storage is NOT covered by the cascade.** Uploaded files live in the `materials` Storage bucket at `${user.id}/${session.id}/${filename}` (`src/pages/api/sessions/index.ts:142`). They must be removed explicitly. The create path's rollback already does this: `supabase.storage.from("materials").remove([storagePath])` (`index.ts:209`).
- **History = the dashboard.** `src/pages/dashboard.astro` renders "Your sessions" from `listSessions()` (`src/lib/services/history/sessions.ts:21`). The list section is currently pure server-rendered Astro markup (no React island). Each row links to `/sessions/${s.id}` and shows a `SessionStatusBadge.astro`.
- **No dialog primitive exists** — `src/components/ui/` contains only `button.tsx`. The app's interactive surfaces are React islands mounted with `client:load` (e.g. `SessionRunner`, `NewSessionForm`).
- **Integration-test harness is established.** The two-identity RLS harness (`src/test/integration/setup.ts`, `factories.ts`) plus the `vi.mock("@/lib/supabase")` handler pattern (`src/pages/api/sessions/[id]/complete.integration.test.ts`) is the template for endpoint tests. `createSessionGraph()` builds a session + material + theory + MCQ owned by a given identity — exactly the victim graph a cascade test asserts against.

## Desired End State

A learner on `/dashboard` sees a delete affordance on each session row. Activating it opens an accessible confirmation dialog; confirming fires `DELETE /api/sessions/[id]`. On success the row disappears from the list in place (no reload), and the session — including its uploaded file in Storage — is gone from every product surface (dashboard list, `/sessions/[id]`, signed-URL downloads). Other sessions, the profile, and the account are untouched.

Verify by: deleting a session from the dashboard and confirming (a) it vanishes from the list, (b) navigating to its old `/sessions/[id]` redirects to `/dashboard` (RLS read miss), (c) no Storage object remains under `${user.id}/${session.id}/`, and (d) integration tests prove the cascade and cross-user isolation.

### Key Discoveries:

- DB cascade + `sessions_delete_own` policy mean **no migration is needed** — the row delete does all DB cleanup (`migration :13-14, :49-50`).
- Storage objects survive the cascade and must be collected **before** the row delete, because the cascade removes the `materials` rows that hold `storage_path` (`index.ts:142, :209`).
- The handler 404-translation pattern (own-vs-other identity, `vi.mock` of `createClient`) is already proven in `complete.integration.test.ts:22-34`.
- `SessionStatusBadge` logic is a trivial status→label/class map (`SessionStatusBadge.astro:11-24`) — cheap to port into the React list island.

## What We're NOT Doing

- **No soft-delete / undo / grace period.** FR-016 explicitly rejected this; delete is hard and irreversible.
- **No delete control on the session detail page** (`/sessions/[id]`) — dashboard-only per the placement decision.
- **No full account deletion** (GDPR-style) — parked to v2 per PRD Non-Goals.
- **No new migration** — the schema already supports delete; we change no tables or policies.
- **No bulk/multi-select delete** — one session at a time.
- **No Playwright E2E for this slice** — integration tests via the RLS harness are the mandated coverage.

## Implementation Approach

Two phases, API-first so the UI wires against a tested endpoint:

1. **`DELETE /api/sessions/[id]`** — auth-gate, then **collect material storage paths → remove Storage objects → delete the session row**. Storage removal happens *before* the row delete (so the `storage_path` values are still readable) and *aborts the whole operation on failure* (so nothing is half-deleted from the learner's view and they can retry). The row delete cascades all child rows.
2. **Dashboard UI** — extract the "Your sessions" list into a `SessionHistoryList` React island that receives the SSR-fetched sessions as a prop, renders each row (porting the status badge), and owns optimistic removal. Each row carries a delete button that opens an accessible confirm dialog; confirming calls the endpoint and, on success, drops the row from local state.

## Critical Implementation Details

- **State sequencing (load-bearing):** storage paths MUST be read before the session row is deleted. The DB cascade deletes the `materials` rows on row-delete, so reading paths afterward returns nothing and orphans the files. Order is: read `materials.storage_path` for the session → `storage.remove(paths)` → `sessions.delete()`.
- **Partial-failure contract:** if Storage removal returns an error, return a 5xx and do NOT delete the session row. The learner retries; no orphaned objects, no half-deleted history entry.

## Phase 1: Delete API endpoint

### Overview

Add a `DELETE` handler at `src/pages/api/sessions/[id].ts` that removes a session's Storage objects then cascade-deletes the session, scoped to the owner by RLS. Cover it with RLS-harness integration tests.

### Changes Required:

#### 1. Delete endpoint

**File**: `src/pages/api/sessions/[id].ts` (new)

**Intent**: Hard-delete the learner's session and its uploaded file(s). Auth-gate (401 if no `context.locals.user`), build the RLS client (500 if unconfigured), require `context.params.id` (400 if missing). Then: read the session's `materials` (`storage_path`) under RLS; if the session read finds nothing, return 404 (mirrors `complete.ts` own-vs-other behavior — a non-owner or missing id sees no rows). Remove the collected Storage paths; on Storage error return 500 WITHOUT deleting the row. Delete the `sessions` row (cascade clears child rows); on DB error return 500. Return 200 on success.

**Contract**: New `export const DELETE: APIRoute`; `export const prerender = false`. Reuse the local `json(body, status)` helper shape from the sibling handlers. Storage paths gathered from `supabase.from("materials").select("storage_path").eq("session_id", id)`, filtering out null paths, then `supabase.storage.from("materials").remove(paths)` only when `paths.length > 0`. Row delete: `supabase.from("sessions").delete().eq("id", id)`. Ordering is fixed: collect paths → remove Storage → delete row (see Critical Implementation Details).

#### 2. Endpoint integration tests

**File**: `src/pages/api/sessions/[id].delete.integration.test.ts` (new)

**Intent**: Prove the cascade is airtight and the operation is owner-isolated. Using the two-identity harness and the `vi.mock("@/lib/supabase")` identity-injection pattern: (a) owner deletes their own session → 200, and the session + every child row (`materials`, `generated_content`, `exercises`) is gone when re-queried via the owner client; (b) user B deleting A's session → 404 (or affects no rows) and A's session + children still exist; (c) missing/already-deleted id → 404.

**Contract**: Mirror `complete.integration.test.ts` structure (`vi.hoisted` mock state, `contextFor(userId, sessionId)` with `method: "DELETE"`, `createSessionGraph` victim graphs for A and B). Assert child-row absence post-delete by re-selecting `materials`/`generated_content`/`exercises` filtered on the deleted `session_id` and expecting empty results. Storage removal is exercised against the local Supabase Storage stack; assert the handler returns 200 and does not throw (a missing object is a no-op for `remove`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (astro check runs in build) — or `npx tsc --noEmit` if available
- Linting passes: `npm run lint`
- Delete endpoint integration tests pass: `npx vitest run src/pages/api/sessions/[id].delete.integration.test.ts`
- Full integration suite still green: `npx vitest run`

#### Manual Verification:

- `DELETE /api/sessions/<own-id>` returns 200 and the session disappears from `/dashboard` after reload
- After delete, no object remains under `materials/${user.id}/${session.id}/` in Supabase Storage
- `DELETE` of another user's session id returns 404 and leaves their data intact

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Dashboard delete UI

### Overview

Surface the delete affordance on the dashboard history list. Extract the list into a `SessionHistoryList` React island that renders rows (with a ported status badge), opens an accessible confirm dialog per row, calls the Phase 1 endpoint, and removes the row from local state on success. Flip the roadmap S-07 status to done.

### Changes Required:

#### 1. Session history list island

**File**: `src/components/session/SessionHistoryList.tsx` (new)

**Intent**: Render the learner's sessions client-side from an SSR-provided prop so a delete can remove a row in place without a page reload. Each row preserves the existing visual structure (title, formatted date, score for completed, "Resume →" for active, status badge) and adds a delete button. Clicking delete opens a confirmation dialog naming the session; confirming fires `DELETE /api/sessions/${id}`, and on a 2xx the session is dropped from local state. Surface a transient inline error if the request fails (the row stays).

**Contract**: Default-exported React component `SessionHistoryList({ sessions }: { sessions: SessionListItem[] })` reusing the `SessionListItem` type from `@/lib/services/history/sessions`. Owns `useState` for the rendered list and per-row pending/deleting state. Port the status badge as a small inline `StatusBadge` (or new `SessionStatusBadge.tsx`) from the label/class maps in `SessionStatusBadge.astro:11-24`. Date formatting via `Intl.DateTimeFormat` (mirror `dashboard.astro:12`). Empty-state markup (the "haven't started any sessions" block) moves into the island so an optimistic delete of the last row shows it. The row link to `/sessions/${id}` is preserved; the delete control must not be nested inside the anchor (separate button, sibling of the link).

#### 2. Accessible confirm dialog

**File**: `src/components/session/SessionHistoryList.tsx` (same file) or `src/components/ui/ConfirmDialog.tsx` (new, if extracted)

**Intent**: Gate the irreversible delete behind an explicit, keyboard-accessible confirmation — not a single click. Show the session title, a clear "this can't be undone" message, and Cancel / Delete actions. Delete is disabled while the request is in flight.

**Contract**: Use the native `<dialog>` element via `ref.showModal()` so focus-trapping, Escape-to-close, and `role="dialog"` come for free with no new dependency; or a controlled modal with `role="dialog"` + `aria-modal`. Confirm/Cancel are real `<button role="button">` elements addressable by accessible name (`Delete` / `Cancel`) so Playwright/RTL can target via `getByRole`. No CSS-only affordance.

#### 3. Wire the island into the dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the inline `<ul>`/empty-state markup in the "Your sessions" section with the React island, passing the SSR-fetched `sessions`. Keep the section heading and the page's existing layout/styling.

**Contract**: Import `SessionHistoryList` and mount with `client:load sessions={sessions}`. Remove the now-duplicated inline list/empty-state JSX and the local `formatDate` helper if it moves into the island. The `SessionStatusBadge.astro` import is dropped from the page if the badge is ported into the island (leave the `.astro` badge in place for any other consumer).

#### 4. Close out roadmap S-07

**File**: `context/foundation/roadmap.md`

**Intent**: Mark S-07 done in both the slice table and the per-slice section once the feature ships, matching the project's close-out convention (cf. commit `f4aa388`).

**Contract**: Flip the S-07 row status from `proposed` to `done` in the slice table (`:41`), update the per-slice `Status:` (`:174`), and the backlog-handoff row (`:211`) to a shipped note. Prose-only edit; no code.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Formatting clean: `npm run format`
- Full test suite still green: `npx vitest run`

#### Manual Verification:

- The dashboard list renders unchanged for existing sessions (title, date, score/Resume, status badge)
- Clicking delete opens a confirmation dialog naming the session; Escape and Cancel both dismiss without deleting
- Confirming delete removes the row in place (no page reload); reloading `/dashboard` confirms it's gone
- Deleting the only session shows the "haven't started any sessions" empty state without reload
- The dialog is reachable and operable by keyboard (Tab to focus, Enter/Space to activate, focus returns sensibly after close)
- Other sessions remain in the list and intact after a delete

**Implementation Note**: After automated verification passes, pause for manual confirmation that the dashboard delete flow works end-to-end.

---

## Testing Strategy

### Unit Tests:

- (Optional) Pure helper for collecting non-null storage paths from material rows, if extracted — otherwise covered by the integration test.

### Integration Tests:

- Owner delete → 200; session + `materials` + `generated_content` + `exercises` rows all absent on re-query (cascade proof).
- Cross-user delete (B → A's session) → 404 / no rows affected; A's graph intact (isolation proof).
- Missing / already-deleted id → 404.
- Storage `remove` exercised against the local stack; handler returns 200 and does not throw on a missing object.

### Manual Testing Steps:

1. Create a session via `/sessions/new`, complete it, return to `/dashboard`.
2. Delete it: confirm the dialog appears, names the session, and Cancel/Escape abort.
3. Confirm delete: the row vanishes without reload.
4. Reload `/dashboard`; confirm the session is gone. Navigate to the old `/sessions/<id>`; confirm redirect to `/dashboard`.
5. In Supabase Storage, confirm no object remains under `materials/${user.id}/${session.id}/`.
6. With two sessions, delete one; confirm the other stays.

## Performance Considerations

Negligible — a single session delete touches one row plus its small child sets and at most a few Storage objects. No new indexes or hot paths; the existing `sessions_user_id_idx` and `*_session_id_idx` indexes cover the reads.

## Migration Notes

None. The schema, cascade, and `sessions_delete_own` RLS policy already exist (baseline migration). No new migration, no data backfill.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-07, `:164-174`)
- PRD: US-03 (`context/foundation/prd.md:77-88`), FR-016 (`:146-147`)
- Cascade + RLS baseline: `supabase/migrations/20260528202720_domain_schema_rls_baseline.sql:13-14, :49-50`
- Storage cleanup pattern: `src/pages/api/sessions/index.ts:209`
- Handler isolation test pattern: `src/pages/api/sessions/[id]/complete.integration.test.ts`
- Owned-row factory: `src/test/integration/factories.ts:30`
- Status badge to port: `src/components/session/SessionStatusBadge.astro:11-24`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Delete API endpoint

#### Automated

- [x] 1.1 Type checking passes (`npm run build`) — c4da847
- [x] 1.2 Linting passes (`npm run lint`) — c4da847
- [x] 1.3 Delete endpoint integration tests pass — c4da847
- [x] 1.4 Full integration suite still green (`npx vitest run`) — c4da847

#### Manual

- [x] 1.5 `DELETE /api/sessions/<own-id>` returns 200 and session disappears from dashboard — c4da847
- [x] 1.6 No Storage object remains under `materials/${user.id}/${session.id}/` — c4da847
- [x] 1.7 `DELETE` of another user's session id returns 404; their data intact — c4da847

### Phase 2: Dashboard delete UI

#### Automated

- [x] 2.1 Type checking passes (`npm run build`)
- [x] 2.2 Linting passes (`npm run lint`)
- [x] 2.3 Formatting clean (`npm run format`)
- [x] 2.4 Full test suite still green (`npx vitest run`)

#### Manual

- [x] 2.5 Dashboard list renders unchanged for existing sessions
- [x] 2.6 Delete opens a confirm dialog naming the session; Escape and Cancel dismiss without deleting
- [x] 2.7 Confirming delete removes the row in place (no reload); reload confirms it's gone
- [x] 2.8 Deleting the only session shows the empty state without reload
- [x] 2.9 Dialog is keyboard-operable with sensible focus return
- [x] 2.10 Other sessions remain intact after a delete
