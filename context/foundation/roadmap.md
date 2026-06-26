---
project: MindTutor
version: 1
status: draft
created: 2026-05-28
updated: 2026-06-26
prd_version: 1
main_goal: market-feedback
top_blocker: time
---

# Roadmap: MindTutor

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Online course participants already have lecture PDFs, slides, and notes; they lack a guided way to absorb that material and verify they understand it before the next module or assessment. MindTutor combines four ideas — personalization to the learner's profile, using the learner's **own** uploaded materials, guided step-by-step sequencing, and interactive exercises with a performance score as a readiness signal.

The product **wedge** — the one trait that, if removed, makes MindTutor indistinguishable from a generic AI chat — is that guided theory and exercises must be grounded in the learner's uploaded files (no off-source claims), and the score is the readiness signal that closes the loop.

## North star

**S-01: First grounded session — a learner can upload a file, walk through AI-generated theory grounded in that file, complete a small exercise set, and see a score.** This is the validation milestone tied to the PRD's primary Success Criterion (one-sitting end-to-end completion of the loop).

> "North star" here means: the smallest end-to-end slice whose successful delivery proves the core hypothesis — placed as early as Prerequisites allow because everything else only matters if this works.

## At a glance

| ID   | Change ID                    | Outcome (user can …)                                                                                   | Prerequisites | PRD refs                                                                                          | Status   |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------- | -------- |
| F-01 | domain-schema-rls-baseline   | (foundation) minimal domain schema + RLS policy template are in place for the session loop             | —             | NFR (per-learner isolation), Access Control                                                       | done     |
| S-01 | first-grounded-session       | upload one file, see AI-generated theory + a small set of exercises grounded in it, and a score        | F-01          | US-01, FR-003, FR-004, FR-007, FR-009 (partial), FR-010, FR-011, FR-012, FR-013, FR-014 (partial) | done     |
| S-02 | per-session-intake-tailoring | answer a brief intake at session start (knowledge level, goal, available time) that tailors generation | S-01          | US-01, FR-018, FR-006 (partial)                                                                   | done     |
| S-03 | onboarding-bio-tailoring     | complete a one-time conversational onboarding that captures a bio reused on every later session        | S-01          | US-01, FR-005, FR-006 (full)                                                                      | done     |
| S-04 | multi-type-exercises         | encounter fill-in-the-blank and matching-pairs exercises alongside MCQ                                  | S-01          | US-01, FR-009 (full)                                                                              | done     |
| S-05 | ask-tutor-mid-session        | ask the AI tutor questions about the uploaded material at any point in the session                     | S-01          | US-01, FR-008                                                                                     | proposed |
| S-06 | session-history-view         | open a completed session from history and revisit its theory, exercises, score, and conversation       | S-01          | FR-014 (read)                                                                                     | done     |
| S-07 | delete-session               | delete a completed session with confirmation, removing all its data                                    | S-06          | US-03, FR-016                                                                                     | proposed |
| S-08 | edit-profile-bio             | edit the profile bio outside an active session; the next session uses the updated bio                  | S-03          | US-02, FR-015                                                                                     | proposed |
| S-09 | password-change              | change the account password by providing the current password and a new one                            | —             | FR-017                                                                                            | done     |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below.

| Stream | Theme                   | Chain                                               | Note                                                                                                  |
| ------ | ----------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A      | Wedge & generation loop | `F-01` → `S-01` → `S-02` → `S-03` → `S-04` → `S-05` | The core market-feedback path: F-01 unlocks S-01 (north star), then enrichments deepen tailoring.     |
| B      | Session lifecycle       | `S-06` → `S-07`                                     | Joins Stream A at `S-01` (history reads sessions persisted by S-01); enables the privacy-delete case. |
| C      | Profile lifecycle       | `S-08`                                              | Joins Stream A at `S-03` (edit requires the bio column to exist); standalone vertical after that.     |
| D      | Auth hardening          | `S-09`                                              | Standalone — extends the existing auth scaffold; can run in parallel with any other stream.           |

## Baseline

What's already in place in the codebase as of 2026-05-28 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 islands + Tailwind 4, shadcn/ui (button only), `src/layouts/Layout.astro`, auth form components at `src/components/auth/*`.
- **Backend / API:** present — Astro SSR (`output: "server"`); auth API routes at `src/pages/api/auth/{signin,signup,signout}.ts`. No domain endpoints yet.
- **Data:** partial — Supabase client wired at `src/lib/supabase.ts`; `supabase/migrations/` directory exists but holds zero SQL files. No domain tables exist.
- **Auth:** present — Supabase SSR auth + middleware redirects + signup/signin/signout/confirm-email/dashboard. **Satisfies FR-001 (signup) and FR-002 (login/logout) directly.** Missing: profile.bio column (covered by S-03) and password change (covered by S-09).
- **Deploy / infra:** present — `@astrojs/cloudflare` v13.5, `wrangler` 4, `.github/workflows/ci.yml` auto-deploys on merge to master. Infrastructure decision recorded in `context/foundation/infrastructure.md` (Cloudflare Workers, not Pages); first deploy recorded in `context/deployment/deploy-plan.md`.
- **Observability:** absent — no Sentry/Datadog/OTel libraries in `package.json`; no log middleware. `wrangler tail` + Workers Observability MCP available per `infrastructure.md` but not wired into app code. Roadmap stays with `wrangler tail` for MVP per the market-feedback / time-blocker framing.

## Foundations

### F-01: Domain schema + RLS baseline

- **Outcome:** (foundation) the minimum domain schema (sessions, materials, generated_content, exercises) is migrated with per-learner RLS policies, and the RLS policy template downstream slices extend is documented.
- **Change ID:** `domain-schema-rls-baseline`
- **PRD refs:** NFR (`visible only to the learner who owns them`), Access Control (flat user model — RLS keys off `auth.uid()`).
- **Unlocks:** `S-01` (first grounded session needs sessions + materials + generated_content + exercises tables), and every later slice that adds a column or table extends F-01's RLS pattern instead of re-deriving it. Reduces the blocking unknown "how do we get RLS right per-learner before the first table ships?".
- **Prerequisites:** —
- **Parallel with:** `S-09` (auth extension that touches `auth.users` only, not domain tables).
- **Blockers:** —
- **Unknowns:** —
- **Risk:** RLS configuration getting per-learner isolation wrong on the first table propagates to every subsequent table. Foundationizing it now (with a documented pattern S-01 reuses) is cheaper than retrofitting policies once five tables exist.
- **Status:** done (deployed to prod 2026-06-08)

## Slices

### S-01: First grounded session (north star)

- **Outcome:** a learner uploads one file (PDF, `.txt`, or `.md`), the AI generates a short theory walkthrough plus a small MCQ exercise set grounded in that file, the learner completes the exercises with per-exercise feedback, and sees a performance score; all of this persists to history.
- **Change ID:** `first-grounded-session`
- **PRD refs:** US-01, FR-003, FR-004, FR-007, FR-009 (partial — MCQ only; multi-type lands in S-04), FR-010, FR-011, FR-012, FR-013, FR-014 (partial — this session's data).
- **Prerequisites:** F-01.
- **Parallel with:** S-09.
- **Blockers:** —
- **Unknowns:**
  - Which LLM provider/model (OpenAI, Anthropic via OpenRouter, etc.) gets wired? `infrastructure.md` names `OPENAI_API_KEY` as an example only — the PRD does not pin a provider. Owner: user. Block: no — `/10x-plan` resolves this at the planning step.
  - How is PDF text extracted under the Workers 30 s CPU limit (the #1 risk in `infrastructure.md`)? Pure-JS parser inside the Worker, or upload-to-Storage + queued parse Worker? Owner: user / `/10x-plan`. Block: no — both paths are buildable; the call belongs to `/10x-plan`.
- **Risk:** This is the wedge proof and the largest slice; it covers the upload→parse→generate→exercise→score loop with seven user-visible FRs. Sequenced first because nothing downstream matters unless this loop works. The two load-bearing risks are (a) PDF parse exceeding the 30 s Worker CPU limit on dense files — the recommended mitigation (Storage + queued parse Worker) is named in `infrastructure.md` and should be baked in from day one, not retrofitted; (b) prompt grounding — if the AI invents claims not in the source, the wedge is broken. Both must be verified explicitly when `/10x-plan` writes the plan for this slice.
- **Resolved in delivery:** LLM provider = OpenRouter (`OPENROUTER_MODEL`, default `openai/gpt-4o-mini`); PDF text extraction runs **client-side** in the browser island (keeps it off the Worker CPU limit), with pdf.js lazy-loaded so it never enters the SSR bundle.
- **Status:** done (deployed to prod 2026-06-08)

### S-02: Per-session intake tailoring

- **Outcome:** at the start of a new session, the AI tutor runs a brief conversational intake (2–3 turns) that captures knowledge level for the uploaded material, learning goal, and available time; those values measurably bias the generated theory and exercise depth.
- **Change ID:** `per-session-intake-tailoring`
- **PRD refs:** US-01, FR-018, FR-006 (partial — per-session params half).
- **Prerequisites:** S-01.
- **Parallel with:** S-03, S-09.
- **Blockers:** —
- **Unknowns:**
  - What's the verification that intake values actually changed the prompt (FR-006 says "measurably change the generated prompt")? A prompt-level diff harness or a manual review pattern? Owner: `/10x-plan`. Block: no.
- **Risk:** Conversational intake adds session-start friction; if the chat exceeds 3 turns it erodes the UX every session. Bound it at prompt level. Sequenced before S-03 (bio) because per-session params change generation per-session, while bio is static — for market-feedback bias, the per-session signal is the more useful one to ship next.
- **Status:** done

### S-03: Onboarding bio tailoring

- **Outcome:** the first time a learner signs in, the AI tutor runs a conversational onboarding that captures their bio (current role, experience, domains) as free text on the profile; the bio is reused on every later session and combines with the per-session intake to set generation depth and idiom.
- **Change ID:** `onboarding-bio-tailoring`
- **PRD refs:** US-01, FR-005, FR-006 (full — both halves now wired).
- **Prerequisites:** S-01.
- **Parallel with:** S-02, S-09.
- **Blockers:** —
- **Unknowns:**
  - What's the bio "schema" — pure free text, or lightly structured (role / years / domains as named fields the chat fills)? PRD says free-text but generation may want structure. Owner: `/10x-plan`. Block: no.
- **Risk:** Bio is a one-shot capture; if the onboarding chat doesn't extract useful signal, every later session inherits a weak prior. Verify by measuring whether bio actually changes the generated prompt (same harness as S-02).
- **Status:** done

### S-04: Multi-type exercises

- **Outcome:** the exercise set generated per session includes fill-in-the-blank and at least one domain-specific exercise type alongside MCQ; the score still aggregates correctly across types.
- **Change ID:** `multi-type-exercises`
- **PRD refs:** US-01, FR-009 (full — replaces the MCQ-only partial in S-01).
- **Prerequisites:** S-01.
- **Parallel with:** S-02, S-03, S-05, S-09.
- **Blockers:** —
- **Unknowns:**
  - ~~What's the third (domain-specific) exercise type?~~ **Resolved 2026-06-14 (user):** third type = **matching pairs** (match terms to definitions/concepts drawn from the source). Chosen for deterministic scoring (no LLM grader in the score path), cross-domain robustness, and lowest grounding risk — the pragmatic reading of "domain-specific" for the MVP.
- **Resolved in delivery:** three exercise types ship — MCQ (from S-01), fill-in-the-blank, and matching pairs. The score must aggregate correctly across all three.
- **Risk:** The hard work is the third type — its UI, scoring, and prompt-level reliability across heterogeneous source materials. Sequenced after the north star because shipping multi-type before the basic loop works would amplify any grounding bugs.
- **Status:** done

### S-05: Ask the tutor mid-session

- **Outcome:** at any point during a session a learner can ask the AI tutor a question about the uploaded material in the chat panel; the answer stays grounded in the source files.
- **Change ID:** `ask-tutor-mid-session`
- **PRD refs:** US-01, FR-008.
- **Prerequisites:** S-01.
- **Parallel with:** S-02, S-03, S-04, S-09.
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Open Q&A is scope-risky if it isn't bounded at the prompt level — generic chat answers erode the wedge. Reuse the same grounding discipline (no off-source claims) from S-01's generation prompt.
- **Status:** proposed

### S-06: Session history view

- **Outcome:** a learner can open a completed session from history and revisit its uploaded files, generated theory, exercises (with the original answers), score, and conversation log.
- **Change ID:** `session-history-view`
- **PRD refs:** FR-014 (read side — write side already shipped in S-01).
- **Prerequisites:** S-01.
- **Parallel with:** S-02, S-03, S-04, S-05, S-09.
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Straightforward read path, but the RLS policy template from F-01 must be applied correctly so a learner cannot list another learner's sessions even by guessing IDs. Verify with a deliberate cross-account read test.
- **Status:** done

### S-07: Delete session

- **Outcome:** a learner deletes a completed session after an explicit confirmation; the session, its uploaded files, generated materials, exercises, score, and conversation log are all removed and the session no longer appears in history.
- **Change ID:** `delete-session`
- **PRD refs:** US-03, FR-016.
- **Prerequisites:** S-06.
- **Parallel with:** S-02, S-03, S-04, S-05, S-08, S-09.
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Hard-delete is irreversible. The cascade across tables AND Supabase Storage objects (uploaded PDFs) must be airtight; orphaned storage objects after delete would violate the PRD's "no longer retrievable through any product surface" criterion.
- **Status:** proposed

### S-08: Edit profile bio

- **Outcome:** a learner edits their profile bio from the account view outside an active session; the next session uses the updated bio; in-progress sessions and history are unaffected.
- **Change ID:** `edit-profile-bio`
- **PRD refs:** US-02, FR-015.
- **Prerequisites:** S-03.
- **Parallel with:** S-04, S-05, S-06, S-07, S-09.
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Mid-session edit is a non-goal — the UI must disable the bio edit surface while a session is in progress. The detector for "session is active" is the load-bearing piece; if it misfires the user either gets blocked unfairly or edits land mid-session (the explicit non-goal).
- **Status:** proposed

### S-09: Password change

- **Outcome:** a learner changes their password from the account view by providing the current password and a new one; the session continues (no forced logout) and the next login uses the new password.
- **Change ID:** `password-change`
- **PRD refs:** FR-017.
- **Prerequisites:** —
- **Parallel with:** F-01, S-01, S-02, S-03, S-04, S-05, S-06, S-07, S-08 (all of them — extends the existing Supabase auth scaffold and touches no domain tables).
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Supabase rotates the session token on password change; the load-bearing detail is keeping the cookie/session valid through the rotation so the learner is not forced to re-login. The Workers `Set-Cookie` semantics (flagged in `infrastructure.md` risk register) make this subtler than it looks — verify on staging, not just `wrangler dev`.
- **Status:** done (deployed to prod 2026-06-08)

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                                                      | Ready for `/10x-plan` | Notes                                                                             |
| ---------- | ---------------------------- | -------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| F-01       | domain-schema-rls-baseline   | Establish per-learner RLS template + minimum domain schema                 | — (done)              | Shipped 2026-06-08. Unlocked every later slice.                                   |
| S-01       | first-grounded-session       | First grounded session (north star): upload → generate → exercises → score | — (done)              | Shipped 2026-06-08. PDF-parse (client-side) + LLM-provider (OpenRouter) resolved. |
| S-02       | per-session-intake-tailoring | Per-session intake (level, goal, time) biases generation                   | — (done)              | Shipped 2026-06-08. Intake (level, goal, time) tailors generation.                |
| S-03       | onboarding-bio-tailoring     | One-time conversational onboarding captures bio                            | — (done)              | Shipped 2026-06-09. One-time onboarding captures free-text bio reused per session. |
| S-04       | multi-type-exercises         | Fill-in-the-blank + matching-pairs exercise types                          | — (done)              | Shipped 2026-06-15. MCQ + fill-in-the-blank + matching pairs; deterministic scoring across all three. |
| S-05       | ask-tutor-mid-session        | Ask the AI tutor questions during a session                                | yes                   | S-01 done — ready to plan.                                                        |
| S-06       | session-history-view         | Revisit a completed session from history                                   | yes                   | S-01 done — ready to plan.                                                        |
| S-07       | delete-session               | Delete a completed session and all its data                                | no                    | Waiting on S-06.                                                                  |
| S-08       | edit-profile-bio             | Edit profile bio outside an active session                                 | yes                   | S-03 done — ready to plan.                                                        |
| S-09       | password-change              | Change password with current-password confirmation                         | — (done)              | Shipped 2026-06-08. Extends auth scaffold; touches no domain tables.              |

## Open Roadmap Questions

_No roadmap-wide Open Questions. The PRD's `## Open Questions` section is empty (status `accepted` per quality cross-check 2026-05-17). Per-slice unknowns (LLM provider for S-01, domain-specific exercise type for S-04, etc.) stay on the slice; `/10x-plan` resolves them when it plans that change._

## Parked

- **Image extraction from PDFs / AI image fallback.** Why parked: PRD §Non-Goals — cut to keep MVP achievable; text-only in v1.
- **Mid-session resume.** Why parked: PRD §Non-Goals — sessions are single-sitting; interruption forces a new session.
- **Adaptive exercise sequencing based on performance.** Why parked: PRD §Non-Goals — order is linear, determined at generation time.
- **Multi-session course planning.** Why parked: PRD §Non-Goals — each session is self-contained.
- **Mobile or native UI.** Why parked: PRD §Non-Goals — web only.
- **Sharing or collaboration features.** Why parked: PRD §Non-Goals — single-learner product.
- **Import beyond PDF / `.txt` / `.md`** (DOCX, PPTX). Why parked: PRD §Non-Goals — MVP supports PDF + raw text + raw markdown only.
- **Web scraping or URL-based ingestion.** Why parked: PRD §Non-Goals — upload only.
- **Spaced-repetition / Anki-style cross-session review.** Why parked: PRD §Non-Goals — no long-term retention algorithm in MVP.
- **Premium tier / paid plans / file-limit upgrades.** Why parked: PRD §Non-Goals — single tier.
- **External LMS integrations** (Canvas, Moodle, …). Why parked: PRD §Non-Goals.
- **Mid-session profile or session-param editing.** Why parked: PRD §Non-Goals — profile edits apply to the next session; per-session params are locked at session start.
- **Full account deletion (GDPR-style).** Why parked: PRD §Non-Goals — per-session delete (S-07) covers the privacy case for MVP; full account delete in v2.
- **Password reset via email** (forgot-password flow). Why parked: PRD §Non-Goals — password CHANGE (S-09) is in scope; users who forget the password re-register in MVP.
- **Sentry / OTel / dedicated observability stack.** Why parked: time blocker + market-feedback bias — `wrangler tail` + Workers Observability MCP cover MVP; richer observability evaluated in v2 if launch signals demand it.

## Done

| Roadmap ID | Change ID                  | Completed  | Notes                                                                                                                                                              |
| ---------- | -------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01       | domain-schema-rls-baseline | 2026-06-08 | Domain schema + per-learner RLS template + private `materials` Storage bucket live on prod Supabase. Migrations pushed via transaction pooler.                     |
| S-01       | first-grounded-session     | 2026-06-08 | North star shipped: upload → grounded theory + MCQs → score → history. OpenRouter generation; client-side PDF parse (pdf.js lazy-loaded to avoid SSR `DOMMatrix`). |
| S-09       | password-change            | 2026-06-08 | Change password with current-password confirmation; no forced logout on token rotation. Verified live.                                                            |
| S-02       | per-session-intake-tailoring | 2026-06-08 | Per-session intake (level, goal, time) tailors generation: typed nullable columns on `sessions`, pure sizing map drives theory/MCQ counts + prompt depth, gated 3-field intake UI, first Vitest harness. Archived → `context/archive/2026-06-08-per-session-intake-tailoring/`. |
| S-03       | onboarding-bio-tailoring   | 2026-06-09 | One-time conversational onboarding captures a free-text bio (`profiles` table, F-01 RLS template, PK=`user_id`); distill service with raw-answers fallback; middleware gate forces not-yet-onboarded learners to `/onboarding`; bio injected as long-term framing in generation (counts stay intake-driven). Completes FR-005 + bio half of FR-006. Archived → `context/archive/2026-06-09-onboarding-bio-tailoring/`. |
| S-04       | multi-type-exercises       | 2026-06-15 | Three exercise types ship — MCQ + fill-in-the-blank + matching pairs; deterministic scoring aggregates across all three. DB CHECK on `exercises.kind` (`20260614000000_exercise_kind_check`). Completes FR-009 (full). Deployed to prod via PR #2; impl-review APPROVED. Archived → `context/archive/2026-06-14-multi-type-exercises/`. |
| S-06       | session-history-view       | 2026-06-26 | Revisit a completed session: dashboard history list + detail-view file download (signed URL) + read-only conversation transcript (read-only-split coexistence with S-05). RLS read path proven cross-account. Completes FR-014 (read). impl-review APPROVED. Archived → `context/archive/2026-06-23-session-history-view/`. |

_`/10x-archive` appends entries here — and flips the matching `Status` to `done` — when a change archives._
