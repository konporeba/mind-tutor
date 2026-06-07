# First Grounded Session (S-01, north star) — Implementation Plan

## Overview

Deliver the wedge-proving loop: a logged-in learner uploads **one** file (PDF / `.txt` / `.md`), the file is parsed **in the browser**, the text is sent to the server which makes a **single structured OpenRouter call** to generate a short **theory walkthrough (with per-claim source citations) + a 5-question MCQ set** grounded in that file. The learner walks the theory in a chat panel, answers the MCQs with **immediate per-exercise feedback**, and sees a **server-computed % score**. Everything persists to the four F-01 tables plus a private Storage bucket, so a later history slice (S-06) can revisit it.

This is the largest, most cross-cutting slice: it introduces the project's first external LLM integration, first Storage usage, first client-side file processing, and the first multi-panel interactive UI — all on top of the F-01 schema/RLS baseline.

## Current State Analysis

- **F-01 is shipped** (`supabase/migrations/20260528202720_domain_schema_rls_baseline.sql`): `sessions`, `materials`, `generated_content`, `exercises` exist, each with denormalized `user_id`, FK cascades, indexes, and the canonical four-policy RLS block for role `authenticated`. `materials.storage_path` is a deliberate, currently-unused hook for this slice. `generated_content.body jsonb` and the `exercises` columns (`options`, `correct_answer`, `learner_answer`, `is_correct`, `feedback`, `answered_at`, `kind default 'mcq'`) already fit the MCQ loop.
- **Typed client wired**: `src/lib/supabase.ts` returns `SupabaseClient<Database> | null` (null when env unset — guard must be preserved). `src/db/database.types.ts` is generated; `src/types.ts` re-exports Row/Insert/Update aliases for all four tables.
- **Auth + middleware present**: `src/middleware.ts` resolves `context.locals.user` and redirects unauthenticated users away from `PROTECTED_ROUTES` (currently only `/dashboard`). Auth API routes use uppercase `POST` exports + zod (per CLAUDE.md).
- **Missing for this slice**: no LLM dependency or key (`astro.config.mjs` env schema declares only `SUPABASE_URL`/`SUPABASE_KEY`, both `optional`), no Storage bucket, no PDF parser, no domain API routes or pages, no client-side islands beyond auth forms. shadcn has only `button`.
- **Hard constraint (infra #1 risk)**: the Cloudflare Worker has a **30 s CPU limit**. Parsing dense PDFs server-side can blow it. LLM/`fetch` waits are I/O, **not** counted against CPU — so a synchronous 10–30 s generation call is safe; PDF parsing is the thing that must stay off the request handler.

### Key Discoveries

- `src/lib/supabase.ts:7-29` — the `createClient(headers, cookies)` factory and its null-guard are the only DB entry point; new server code reuses it.
- `astro.config.mjs:17-22` — env is declared via `envField` with `context: "server", access: "secret"`; new secrets (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`) go here.
- `docs/reference/contract-surfaces.md` + `docs/reference/rls-policy-template.md` — the canonical RLS pattern and the registry this slice must extend (new bucket, new column, generation contract, routes).
- `supabase/tests/rls_isolation_test.sql` — the pgTAP harness to extend for Storage + the new column.
- Materials bytes must be persisted (FR-014; S-06 "revisit uploaded files"; S-07 "delete uploaded files") — client-side parsing does **not** remove the need to store the original file.

## Desired End State

A learner signs in, clicks **Start new session** on the dashboard, uploads one supported file (≤20 MB), watches a progress indicator while the session generates, then lands on `/sessions/[id]` showing theory steps (each with a visible source citation) beside a 5-question MCQ panel and a milestone progress bar. They answer each MCQ and get immediate correct/incorrect feedback, then see a completion screen with a percentage score. Reloading the page restores the same session from the database. A second learner cannot read or open the first learner's session, material, or uploaded file. `npx supabase test db` passes (including new Storage + column coverage); `npm run lint` and `npm run build` are green.

## What We're NOT Doing

- **Per-session intake** (knowledge level / goal / time) — S-02. Session sizing is a fixed default here.
- **Onboarding bio / profile tailoring** — S-03.
- **Multi-type exercises** (fill-in-the-blank, domain-specific) — S-04. **MCQ only.**
- **Ask-the-tutor free-text Q&A** — S-05. The chat panel is a **read-only theory walkthrough**.
- **History list view** — S-06. We build the per-session route `/sessions/[id]`, not a list/index of past sessions.
- **Delete session** — S-07. (Cascade + bucket layout are designed so S-07 plugs in cleanly.)
- **Multiple files per session** — FR-003 allows 1–2; S-01 ships **one** file to keep the loop minimal (schema already supports many materials per session).
- **Async job queue / second parser Worker** — explicitly rejected (client-side parse removes the need).
- **Streaming generation, per-step generation, soft-delete, a JS unit-test runner** (Vitest deferred to Module 3).

## Implementation Approach

Client-side parsing (pdfjs-dist in the browser; `.txt`/`.md` read as raw text) sidesteps the Worker CPU cliff entirely — the server only ever receives already-extracted text plus the original bytes. Generation is **one** OpenRouter call (OpenAI-compatible SDK pointed at OpenRouter's base URL) that returns a single JSON object (theory steps with citations + MCQ set), zod-validated with one retry on malformed output. The call is synchronous behind a progress indicator (safe: it's I/O wait). Scoring is server-computed from persisted rows. Persistence reuses the F-01 tables; the original file goes to a new private `materials` Storage bucket with per-user-path RLS. Build order is dependency-first: schema/infra → services → API → UI → verification, each phase independently checkable.

## Critical Implementation Details

- **Worker CPU vs I/O**: the 30 s limit is **CPU time**, and `fetch`/LLM wait does not count — so synchronous generation is fine, but **never** parse PDFs in a request handler. Parsing stays in the browser.
- **OpenRouter structured output is not strictly schema-enforced** across all models. Do not assume valid JSON: request `response_format: { type: "json_object" }`, parse, **zod-validate**, and retry the call once on failure before surfacing an error. This is the load-bearing reliability detail of Phase 2.
- **Citations contract**: each theory step must carry a `citation` (a verbatim quote/span lifted from the source text). The server validates that each citation substring actually occurs in the stored `extracted_text`; steps whose citation can't be found fail validation and trigger the retry. This is how the PRD's "no off-source claims" wedge is enforced concretely.
- **Storage RLS by path**: objects are stored under `{user_id}/{session_id}/{filename}`; the bucket policies key off `(storage.foldername(name))[1] = auth.uid()::text` so a learner can only touch their own prefix — mirroring the table RLS template.
- **Cookie/session on Workers** (infra risk): all server DB access goes through the existing `createClient(headers, cookies)` so `@supabase/ssr` cookie handling stays consistent; do not instantiate raw clients.

## Phase 1: Schema, Storage & Environment Foundation

### Overview

Lay the data + infra groundwork: persist extracted text, create the private file bucket with per-user RLS, declare the OpenRouter secrets, install dependencies, regenerate types, and extend the pgTAP isolation proof.

### Changes Required:

#### 1. Additive schema migration

**File**: `supabase/migrations/<timestamp>_first_grounded_session.sql`

**Intent**: Add the column needed to persist parsed text and create the Storage bucket + policies for original files, without altering F-01's tables/policies.

**Contract**:

- `alter table public.materials add column extracted_text text;` (nullable — additive, no backfill).
- Create a **private** Storage bucket `materials` via `storage.buckets` insert (id/name `materials`, `public = false`).
- Four `storage.objects` policies scoped to `bucket_id = 'materials'`, role `authenticated`, ownership by path prefix using `(storage.foldername(name))[1] = (select auth.uid())::text` for select/insert/update/delete — the Storage analogue of the table RLS template. Document the path convention `{user_id}/{session_id}/{filename}` in a SQL comment.

#### 2. Environment schema + local secrets

**File**: `astro.config.mjs`, `.env.example`, `.dev.vars` (if present; otherwise note in `.env.example`)

**Intent**: Declare the OpenRouter key and model so generation code reads them via `astro:env/server`, matching the existing secret pattern.

**Contract**: add to `env.schema`: `OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true })` and `OPENROUTER_MODEL: envField.string({ context: "server", access: "public", optional: true, default: "<sensible default model>" })`. Mirror keys in `.env.example`. Keep `optional: true` so the existing "env unset → null/no-op" posture holds in CI.

#### 3. Dependencies

**File**: `package.json`

**Intent**: Add the browser PDF parser and an OpenAI-compatible client for OpenRouter.

**Contract**: add `pdfjs-dist` (client-side parse; load the worker per Vite/Astro island conventions) and `openai` (instantiated with `baseURL: "https://openrouter.ai/api/v1"` + the OpenRouter key). No server-side PDF library is added (parsing is client-only).

#### 4. Regenerate types + aliases

**File**: `src/db/database.types.ts`, `src/types.ts`

**Intent**: Keep the typed client in sync with the new column; types must not drift from the migration.

**Contract**: regenerate `database.types.ts` (`npx supabase gen types --local`); `src/types.ts` Material aliases pick up `extracted_text` automatically (no manual edit unless a new table is added — none is).

#### 5. Extend RLS isolation test

**File**: `supabase/tests/rls_isolation_test.sql`

**Intent**: Prove the new Storage bucket enforces per-learner isolation and that the new column is covered by existing table policies.

**Contract**: add cross-account cases asserting learner B cannot select/insert/update/delete an object under learner A's prefix in bucket `materials`; confirm `materials.extracted_text` is reachable only under the existing `materials_*_own` policies.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- All four domain tables still report RLS enabled; `materials` bucket exists and is private
- Isolation test passes: `npx supabase test db`
- Types regenerate without diff drift: `npx supabase gen types --local` then `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- The `materials` bucket is visible in Supabase Studio and not public
- A file uploaded under one user's prefix is not listable by another user via the client

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual Storage checks before Phase 2.

---

## Phase 2: Generation & Scoring Services

### Overview

Pure server-side business logic (no routes, no UI): the grounded generation contract, the OpenRouter call with validation/retry, and the scoring function.

### Changes Required:

#### 1. Generation contract (zod schemas + types)

**File**: `src/lib/services/generation/schema.ts`

**Intent**: Define the structured shape the LLM must return and the persisted shapes, so output is validated, not trusted.

**Contract**: zod schemas for the LLM response — `theory: { position, heading, body, citation }[]` (target 3–5 items) and `exercises: { position, prompt, options: string[], correctIndex }[]` (exactly 5, `kind: 'mcq'`). Export inferred TS types. Define how these map onto `generated_content.body` (theory step JSON incl. `citation`) and `exercises` columns (`options`, `correct_answer` = the correct option, `feedback` generated per exercise).

#### 2. Prompt builder + OpenRouter client

**File**: `src/lib/services/generation/generate.ts`, `src/lib/services/generation/openrouter.ts`

**Intent**: Build a grounding-first prompt that injects the full source text and forbids outside knowledge, call OpenRouter, validate, and retry once.

**Contract**: `generateSession(sourceText: string): Promise<GeneratedSession>`.

- System prompt: only use facts present in the provided source; every theory step must include a `citation` quoting the source span it derives from; produce exactly 5 MCQs with one correct option and short feedback; request `response_format: { type: "json_object" }`.
- After parse + `zodSchema.safeParse`, **validate every `citation` is a substring of `sourceText`**; on any failure (bad JSON, schema miss, citation not found), retry the call once, then throw a typed `GenerationError`.
- `openrouter.ts` instantiates `openai` with the OpenRouter `baseURL` + key from `astro:env/server`; throws a typed error if the key is unset.

#### 3. Scoring service

**File**: `src/lib/services/scoring.ts`

**Intent**: Compute the single performance score from persisted answers (FR-011).

**Contract**: `computeScore(exercises: Pick<Exercise, "is_correct">[]): number` → `round(correct / total * 100)`; total 0 ⇒ 0. Server-only; the API layer reads rows and calls this.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- A dev harness (temporary script or REPL) run against a real `.md` sample returns 3–5 cited theory steps + 5 valid MCQs, and every citation appears verbatim in the source
- Feeding deliberately malformed/thin text triggers exactly one retry then a clean typed error (no unhandled crash)

**Implementation Note**: Pause for human confirmation that generation output is grounded (citations trace to source) before Phase 3 — this is the wedge check.

---

## Phase 3: API Routes

### Overview

Wire the server endpoints that orchestrate persistence + generation + scoring. All routes `export const prerender = false`, validate input with zod, and require `locals.user` (401 otherwise). All DB access via `createClient(request.headers, cookies)`.

### Changes Required:

#### 1. Create session + upload + generate

**File**: `src/pages/api/sessions/index.ts` (`POST`)

**Intent**: The one call the New Session page makes: persist the file + text, create the session, generate, and persist generated content + exercises — returning the new session id.

**Contract**: accepts the original file (bytes) + `extractedText` + filename/mime/size (multipart or JSON+base64; pick the simpler for Astro/Workers). Server **re-validates** mime ∈ {pdf, txt, md} and size ≤ 20 MB (reject with explanatory 400 before processing). Then: insert `sessions` (status `active`, `user_id`), upload bytes to `materials` bucket at `{user_id}/{session_id}/{filename}` and insert `materials` (with `storage_path` + `extracted_text`), call `generateSession`, insert `generated_content` (theory rows) + `exercises` (5 MCQ rows) with correct positions. Return `{ id }`. On `GenerationError`, clean up the half-created session (or mark `abandoned`) so the learner isn't left in a broken state, and return a 502 with a retry-able message. `user_id` always `= locals.user.id` (RLS enforces too).

#### 2. Answer an exercise

**File**: `src/pages/api/sessions/[id]/exercises/[exerciseId].ts` (`POST`)

**Intent**: Record the learner's answer and return immediate per-exercise feedback (FR-010).

**Contract**: body `{ answer }` (selected option). Update the exercise row: `learner_answer`, `is_correct` (compare to `correct_answer`), `answered_at`; return `{ is_correct, feedback, correct_answer }`. RLS + an explicit `user_id`/`session_id` match guard prevent cross-session writes.

#### 3. Complete session + score

**File**: `src/pages/api/sessions/[id]/complete.ts` (`POST`)

**Intent**: Finalize the session and compute the score once all exercises are answered (FR-011).

**Contract**: read the session's exercises, `computeScore`, update `sessions` (`score`, `status = 'completed'`, `completed_at`). Return `{ score }`. Idempotent-safe if called twice.

#### 4. Protect routes

**File**: `src/middleware.ts`

**Intent**: Gate the new session surfaces.

**Contract**: add `/sessions` to `PROTECTED_ROUTES` (append — trivial). API routes additionally check `locals.user` and return 401 JSON.

### Success Criteria:

#### Automated Verification:

- Type checking + build pass: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- `POST /api/sessions` with a real file creates a session and returns an id; rows exist in all relevant tables and the file exists in Storage under the user prefix
- Oversize/unsupported payloads return an explanatory 400 with no rows written
- Answering an exercise returns correct feedback; completing returns the right percentage
- Unauthenticated calls to any `/api/sessions*` route return 401

**Implementation Note**: Pause for human confirmation of the API round-trip before Phase 4.

---

## Phase 4: User Interface

### Overview

The learner-facing flow: dashboard entry, New Session page (client parse + validate + progress), the `/sessions/[id]` run page (responsive theory + exercise panels, milestone bar, citations), and the completion screen.

### Changes Required:

#### 1. Dashboard entry point

**File**: `src/pages/dashboard.astro`

**Intent**: Give the learner a way to start a session (FR-007 entry).

**Contract**: add a "Start new session" link/button to `/sessions/new`.

#### 2. New Session page (upload → parse → generate)

**File**: `src/pages/sessions/new.astro` + `src/components/session/NewSessionForm.tsx` (React island), client parse helper `src/components/session/lib/parseFile.ts`

**Intent**: Accept one file, parse it **in the browser**, validate, and drive the synchronous generate call with a progress indicator (FR-003, FR-004, NFR).

**Contract**: file input (accept `.pdf,.txt,.md`); client validates type + ≤20 MB and shows an inline error on failure; parse via `pdfjs-dist` (PDF) or `file.text()` (txt/md); show a progress indicator with step labels ("Reading file…", "Generating your session…") while `POST /api/sessions` runs; on success redirect to `/sessions/[id]`; on error show a retry-able message. Corrupted PDF ⇒ parse throws ⇒ inline error.

#### 3. Session run page

**File**: `src/pages/sessions/[id].astro` + `src/components/session/SessionRunner.tsx` (React island)

**Intent**: Render the persisted session: side-by-side chat/theory + exercise panels, milestone progress, immediate feedback, and the score (FR-007, FR-010, FR-011, FR-012, FR-013).

**Contract**: the `.astro` page loads `sessions` + `generated_content` + `exercises` for the id via the server client (RLS scopes to owner; 404/redirect if not found). The island renders: a **theory panel** showing ordered steps each with its visible `citation`; an **exercise panel** with one MCQ at a time (or a list) wired to the answer route for immediate feedback; a **milestone bar** (FR-013) showing the interleaved theory→practice sequence with the current step highlighted; **responsive layout** — side-by-side on wide screens, tabbed/stacked on narrow (FR-012, via `cn()` + Tailwind). When all exercises are answered, call the complete route and show the **completion screen** with the score. Reloading restores state from persisted rows.

#### 4. shadcn components as needed

**File**: `src/components/ui/*`

**Intent**: Use consistent primitives.

**Contract**: add the few shadcn components the panels need (e.g. `card`, `progress`, `tabs`) via `npx shadcn@latest add …`; merge classes with `cn()` per CLAUDE.md.

### Success Criteria:

#### Automated Verification:

- Build + type check pass: `npm run build`
- Linting passes (incl. jsx-a11y): `npm run lint`

#### Manual Verification:

- Full happy path in a browser: dashboard → upload a real PDF and a `.md` → progress shows → session renders with cited theory + 5 MCQs → answer all → score appears
- Responsive: side-by-side on a wide window, tabbed/stacked when narrowed (FR-012)
- Milestone bar reflects the sequence and highlights the current step (FR-013)
- Reloading `/sessions/[id]` restores the same session
- Unsupported/oversize/corrupted file shows an explanatory error (FR-004)

**Implementation Note**: Pause for human confirmation of the end-to-end UX before Phase 5.

---

## Phase 5: End-to-End Verification & Contract Documentation

### Overview

Prove cross-account isolation across the whole loop, run the manual E2E checklist, and register the new contract surfaces so downstream slices extend them.

### Changes Required:

#### 1. Update contract-surfaces registry

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Record the load-bearing names this slice introduces.

**Contract**: add entries for the `materials` Storage bucket + path convention `{user_id}/{session_id}/{filename}` and its policies; the `materials.extracted_text` column; the generation contract location (`src/lib/services/generation/*`) and its JSON shapes; the new API routes (`POST /api/sessions`, `…/exercises/[exerciseId]`, `…/complete`); and the OpenRouter env vars.

#### 2. Manual E2E checklist

**File**: `context/changes/first-grounded-session/verification.md`

**Intent**: A repeatable script proving the PRD success criteria for this slice.

**Contract**: document the steps (sign in → upload → generate → answer → score → reload) plus the cross-account negative test (learner B cannot open learner A's `/sessions/[id]` or fetch their file) and the grounding spot-check (every theory citation traces to the source).

### Success Criteria:

#### Automated Verification:

- `npx supabase test db` passes (table + Storage isolation)
- `npm run lint` and `npm run build` are green

#### Manual Verification:

- The full E2E checklist passes end-to-end in one sitting (PRD primary success criterion)
- Cross-account negative test confirms isolation (NFR)
- Grounding spot-check confirms no off-source claims (NFR / wedge)

**Implementation Note**: Final phase — on completion the change is ready for `/10x-impl-review`.

---

## Testing Strategy

### Automated (pgTAP, reusing F-01's harness):

- Table RLS isolation for the four tables (existing) + the new `extracted_text` column.
- Storage object isolation: learner B denied select/insert/update/delete under learner A's prefix in bucket `materials`.

### Manual:

1. Sign in; from dashboard click Start new session.
2. Upload a real lecture PDF; confirm progress indicator, then a session with 3–5 cited theory steps + 5 MCQs.
3. Repeat with a `.md` and a `.txt` file.
4. Answer each MCQ; confirm immediate correct/incorrect feedback.
5. Confirm the completion screen shows the right percentage.
6. Reload `/sessions/[id]`; confirm state restored.
7. Upload a >20 MB file, an unsupported type, and a corrupted PDF; confirm explanatory errors and no partial rows.
8. As a second account, attempt to open the first account's session URL and file; confirm denial.
9. Spot-check that every theory citation appears verbatim in the source.

## Performance Considerations

- PDF parsing runs in the browser → the 30 s Worker CPU limit is not exercised by parsing.
- Generation is one synchronous OpenRouter call (I/O wait, not CPU) behind a progress indicator; meets the PRD's "continuous visible progress > 2 s".
- 20 MB upload bytes cross the request boundary directly (Cloudflare 100 MB body cap — no signed-URL workaround needed for MVP).

## Migration Notes

- One additive migration (`materials.extracted_text` + `materials` bucket/policies); no backfill, no destructive change to F-01. Per infra's rollback rule, the down-direction (drop column, drop bucket policies) should be writable in the same PR if a paired rollback is ever needed.

## References

- Roadmap: `context/foundation/roadmap.md` (S-01)
- PRD: `context/foundation/prd.md` (US-01, FR-003/004/007/009/010/011/012/013/014, NFR)
- Infrastructure risks: `context/foundation/infrastructure.md` (30 s CPU limit, Workers cookie edge cases, Storage)
- F-01 baseline: `supabase/migrations/20260528202720_domain_schema_rls_baseline.sql`, `docs/reference/rls-policy-template.md`, `docs/reference/contract-surfaces.md`
- DB entry point: `src/lib/supabase.ts:7`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, Storage & Environment Foundation

#### Automated

- [ ] 1.1 Migration applies cleanly: `npx supabase db reset`
- [ ] 1.2 Four tables RLS-enabled; `materials` bucket exists and is private
- [ ] 1.3 Isolation test passes: `npx supabase test db`
- [ ] 1.4 Types regenerate without drift: `npx supabase gen types --local` + `npm run build`
- [ ] 1.5 Linting passes: `npm run lint`

#### Manual

- [ ] 1.6 `materials` bucket visible in Studio and not public
- [ ] 1.7 One user's file not listable by another user via the client

### Phase 2: Generation & Scoring Services

#### Automated

- [x] 2.1 Type checking passes: `npm run build` — f24b70b
- [ ] 2.2 Linting passes: `npm run lint`

#### Manual

- [ ] 2.3 Harness against a real sample returns 3–5 cited theory steps + 5 valid MCQs; citations trace to source
- [ ] 2.4 Malformed/thin text triggers one retry then a clean typed error

### Phase 3: API Routes

#### Automated

- [x] 3.1 Type checking + build pass: `npm run build` — 7b9fe4e
- [ ] 3.2 Linting passes: `npm run lint`

#### Manual

- [ ] 3.3 `POST /api/sessions` creates a session, rows in all tables, file in Storage under user prefix
- [ ] 3.4 Oversize/unsupported payloads return explanatory 400 with no rows written
- [ ] 3.5 Answering returns correct feedback; completing returns the right percentage
- [ ] 3.6 Unauthenticated `/api/sessions*` calls return 401

### Phase 4: User Interface

#### Automated

- [x] 4.1 Build + type check pass: `npm run build` — bc27921
- [ ] 4.2 Linting passes (incl. jsx-a11y): `npm run lint`

#### Manual

- [ ] 4.3 Full happy path in browser (dashboard → upload PDF + .md → progress → cited theory + 5 MCQs → answer all → score)
- [ ] 4.4 Responsive: side-by-side wide, tabbed/stacked narrow (FR-012)
- [ ] 4.5 Milestone bar reflects sequence and highlights current step (FR-013)
- [ ] 4.6 Reloading `/sessions/[id]` restores the session
- [ ] 4.7 Unsupported/oversize/corrupted file shows explanatory error (FR-004)

### Phase 5: End-to-End Verification & Contract Documentation

#### Automated

- [ ] 5.1 `npx supabase test db` passes (table + Storage isolation)
- [ ] 5.2 `npm run lint` and `npm run build` green

#### Manual

- [ ] 5.3 Full E2E checklist passes in one sitting (PRD primary criterion)
- [ ] 5.4 Cross-account negative test confirms isolation (NFR)
- [ ] 5.5 Grounding spot-check confirms no off-source claims (NFR / wedge)
