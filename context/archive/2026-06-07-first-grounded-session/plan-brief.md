# First Grounded Session (S-01) — Plan Brief

> Full plan: `context/changes/first-grounded-session/plan.md`

## What & Why

S-01 is the roadmap **north star**: the smallest end-to-end slice that proves MindTutor's wedge. A learner uploads **one** file (PDF / `.txt` / `.md`), the AI generates a short **theory walkthrough (with per-claim source citations) + a 5-question MCQ set grounded in that file**, the learner answers with **immediate feedback** and sees a **% score**, and the whole session **persists**. If this loop works, the core hypothesis (guided, grounded study from the learner's own materials) is validated; nothing downstream matters until it does.

## Starting Point

F-01 is shipped: the four domain tables (`sessions`, `materials`, `generated_content`, `exercises`) exist with per-learner RLS, a typed client, and `src/types.ts` aliases; `materials.storage_path` is an unused hook waiting for this slice. Auth + middleware + dashboard are in place. **Missing:** any LLM integration or key, any Storage bucket, any PDF parser, and all domain API routes/pages. The Worker's **30 s CPU limit** on PDF parsing is infra's #1 named risk.

## Desired End State

From the dashboard a learner clicks **Start new session**, uploads a file, watches a progress indicator, then lands on `/sessions/[id]` with cited theory beside a 5-MCQ panel and a milestone bar. They answer each MCQ (immediate feedback), get a % score, and can reload to restore the session. A second learner cannot read or open the first's session or file. pgTAP + lint + build are green.

## Key Decisions Made

| Decision         | Choice                                                                 | Why (1 sentence)                                                         | Source |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| LLM provider     | OpenRouter (OpenAI-compatible SDK)                                     | Provider-agnostic, swap models via config with one key.                  | Plan   |
| PDF parsing      | Client-side (pdfjs-dist in browser)                                    | Sidesteps the 30 s Worker CPU cliff entirely — the headline MVP risk.    | Plan   |
| Generation shape | Single structured call for the whole session                           | Simplest, atomic, easiest to ground and validate.                        | Plan   |
| Generation UX    | Synchronous with progress indicator                                    | LLM/fetch wait is I/O (not CPU-limited); meets "visible progress >2s".   | Plan   |
| Grounding        | **Per-claim source citations** (server-validated against stored text)  | Inspectable enforcement of "no off-source claims"; bounds the wedge.     | Plan   |
| Scoring          | Percent correct, server-computed on completion                         | Matches FR-011; single tamper-resistant source of truth.                 | Plan   |
| Session size     | Fixed default: ~3–5 theory steps + 5 MCQs                              | Reliable single-call generation; real input for the milestone UI.        | Plan   |
| Upload errors    | Client pre-check + server re-validation, inline error                  | Fast feedback + defense-in-depth (FR-004).                               | Plan   |
| Session flow     | Dashboard → New Session → `/sessions/[id]` → completion                | Clean per-session URL that S-06/S-07 plug into later.                    | Plan   |
| File persistence | Original bytes in private `materials` bucket + `extracted_text` column | Satisfies FR-014; feeds S-06 and citation validation without re-parsing. | Plan   |
| Verification     | Extend pgTAP (Storage + column) + manual E2E checklist                 | Reuses F-01's harness; Vitest deferred to Module 3.                      | Plan   |

## Scope

**In scope:** one-file upload, client parse, grounded single-call generation with citations, 5 MCQs with immediate feedback, % score, full persistence (tables + Storage bucket), responsive run UI with milestone bar, OpenRouter wiring, pgTAP extension.

**Out of scope:** intake (S-02), bio/onboarding (S-03), multi-type exercises (S-04 — **MCQ only**), ask-tutor Q&A (S-05 — theory is read-only), history list (S-06), delete (S-07), multiple files per session, async parse queue, streaming, Vitest.

## Architecture / Approach

Browser parses the file (pdfjs-dist / `file.text()`) → posts extracted text + original bytes to `POST /api/sessions` → server re-validates, persists session + material (bytes to Storage, text to column), calls `generateSession()` (one OpenRouter call, zod-validated, citations checked against source, one retry) → writes theory + MCQ rows. The `/sessions/[id]` page loads rows under RLS and renders a React island (theory+exercise panels, milestone bar); per-exercise answers and final scoring go through dedicated routes. All DB access via the existing `createClient(headers, cookies)`.

## Phases at a Glance

| Phase                            | What it delivers                                                                       | Key risk                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1. Schema, Storage & env         | `extracted_text` column, private bucket + path RLS, OpenRouter env, deps, types, pgTAP | Storage path-prefix policy written subtly wrong                         |
| 2. Generation & scoring services | Grounded prompt + validated/retried OpenRouter call + scoring                          | OpenRouter JSON not strictly schema-enforced — must validate, not trust |
| 3. API routes                    | create+generate, answer, complete (auth-gated)                                         | Half-created session on generation failure left in broken state         |
| 4. UI                            | New Session, run page (responsive, milestone, citations), completion                   | Multi-panel state + responsive layout complexity                        |
| 5. E2E verification & docs       | pgTAP + manual checklist + contract-surfaces update                                    | Cross-account/Storage isolation regression                              |

**Prerequisites:** F-01 (done); local Supabase (Docker) running; an OpenRouter API key in `.dev.vars`.
**Estimated effort:** ~2–3 focused after-hours sessions across the 5 phases (Phase 4 is the largest).

## Open Risks & Assumptions

- OpenRouter structured-output strictness varies by model → mitigated by zod validation + citation substring check + one retry; a model with reliable JSON output should be the configured default.
- Citations are validated by substring match against extracted text — whitespace/encoding normalization may be needed so legitimate quotes aren't falsely rejected.
- Assumes one uploaded file is enough to prove the wedge (FR-003 permits two; schema already supports many).
- Generation failure mid-create must not leave a broken/locked session (PRD guardrail) — handled by cleanup/`abandoned` on error.

## Success Criteria (Summary)

- A learner completes upload → generate → exercises → score **end-to-end in one sitting**, and reload restores the session (PRD primary criterion).
- Every theory citation traces verbatim to the source file (NFR / wedge).
- A second learner cannot reach the first learner's session, material, or file (NFR; proven by pgTAP + manual negative test).
