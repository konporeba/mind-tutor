---
project: 'MindTutor'
version: 1
status: draft
created: 2026-05-24
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 5
  hard_deadline: 2026-07-05
  after_hours_only: true
---

# MindTutor — Product Requirements Document

## Vision & Problem Statement

Online course participants — people taking MOOCs, bootcamps, or self-directed professional courses — already have the materials they need to study (lecture PDFs, slides, course notes). What they lack is a personalized, guided way to actually absorb that material and verify they understand it before they move on or sit an assessment. Manually re-reading PDFs is slow, has no feedback loop, and doesn't adapt to how much time the learner has or what they already know.

Existing tools each solve one piece, but none combine them. General-purpose chat assistants answer questions but don't structure a study path. Mainstream course platforms use their own curriculum, not the learner's materials. Flashcard tools are review-only and require the user to author cards. MindTutor combines four ideas — personalization to the learner's profile (background + available time), using the learner's own uploaded materials, guided step-by-step sequencing, and interactive exercises generated from those materials with a performance score as a readiness signal.

## User & Persona

**Primary persona**: An online course participant — typically a working adult or independent learner enrolled in a MOOC, bootcamp, or self-paced professional course. They have lecture PDFs, slides, or course notes they're expected to master. They want efficient, guided study that fits the time they actually have between work and life, and a way to know whether they've absorbed the material before the next module or assessment.

## Success Criteria

### Primary

- A learner can complete a full session end-to-end in one sitting: sign up → upload 1–2 files → finish the conversational profiling → walk through guided learning → complete generated exercises → see a performance score. If this works for ~80% of attempts with materials in the supported formats, the MVP has succeeded.

### Secondary

- The performance score the learner receives feels right to them — it correlates with their own self-assessment of how well they understood the material. Validates that the scoring is calibrated, not just present.

### Guardrails

- A learner can complete a session in one sitting without crashes, timeouts, or unrecoverable errors. Reliability floor.
- If a session is interrupted mid-flow, the learner is not blocked from starting a new session (no broken/locked state). Resume mid-session is explicitly out of scope (see Non-Goals) — this guardrail says interruption must not corrupt the account or block the next attempt.

## User Stories

### US-01: Learner completes a guided study session from uploaded materials

- **Given** a logged-in learner who has uploaded 1–2 study files
- **When** they start a new session and complete the session-start intake
- **Then** the AI tutor walks them through the material in the chat panel and presents exercises in the right panel; after completing exercises they see a performance score

#### Acceptance Criteria

- First-time learners complete a one-time onboarding conversation that captures their bio (FR-005); the bio is reused on subsequent sessions
- Every session begins with a brief intake that captures knowledge level for this material, learning goal, and available time (FR-018)
- Guided content uses both the bio and the per-session intake to set depth and pacing
- Guided content references concepts present in the uploaded files (not generic material)
- Exercise set includes at least two distinct exercise types
- Performance score reflects the percentage of exercises answered correctly
- The completed session (per-session params, score, exercises, generated materials, conversation) is persisted to the learner's history

### US-02: Learner revises their profile bio between sessions

- **Given** a logged-in learner whose role or background has changed since onboarding (new job, advanced past beginner, picked up a new domain)
- **When** they open the account view and edit their bio
- **Then** the new bio is saved and applied to the next session they start; already-completed sessions in history are unaffected

#### Acceptance Criteria

- The bio is editable as free-text from the account view
- Edits are not available during an active learning session
- The next started session uses the updated bio (alongside that session's own intake params)
- Sessions already in history retain the bio that was active when they ran (no retroactive change)
- Per-session params (knowledge level, learning goal, available time) do NOT appear in the profile edit view — they are session-scoped and captured at each session start (FR-018)

### US-03: Learner deletes a session from history

- **Given** a logged-in learner viewing their session history with at least one completed session
- **When** they choose to delete a specific session and confirm the prompt
- **Then** the session and all its associated data (uploaded files, generated materials, exercises, score, conversation history) are removed and the session no longer appears in history

#### Acceptance Criteria

- Delete requires an explicit confirmation step (not a single-click action)
- After delete, the session and all its data are no longer retrievable through any product surface
- Other sessions in history are unaffected
- Account, profile, and other sessions remain intact

## Functional Requirements

### Authentication

- FR-001: A learner can sign up with email + password. Priority: must-have
  > Socratic: Counter-argument considered: "anonymous try-mode could reduce signup friction." Resolution: stands — persistence (resume, score history) requires accounts; anonymous mode is v2.
- FR-002: A learner can log in and out. Priority: must-have
  > Socratic: Counter-argument considered: "logout might be unnecessary for MVP." Resolution: stands — shared devices exist; logout is table stakes and cheap to implement.
- FR-017: A learner can change their password from the account view by providing the current password and a new one. Priority: must-have
  > Socratic: Counter-argument considered: "password reset via email is the more common request — change-with-current is half a feature." Resolution: in scope; reset-via-email is dropped (see Non-Goals) to keep auth surface minimal. Change-with-current covers the routine rotation case; users who forget their password can re-register in v2.

### Material upload

- FR-003: A learner can upload 1–2 files per session in any of the supported formats: PDF, plain text (`.txt`), or Markdown (`.md`, treated as plain text — no markdown rendering). Priority: must-have
  > Socratic: Counter-argument considered: "demo content could replace upload to ship faster." Resolution: stands — 'use YOUR materials' is the differentiating insight; removing it removes the product.
- FR-004: A learner sees an error if a file is unsupported, corrupted, or exceeds a size limit. Priority: must-have
  > Socratic: Counter-argument considered: "silent ignore could simplify the UX." Resolution: stands — silent failures destroy trust; a toast/banner is cheap.

### Profiling

- FR-005: A learner completes a one-time conversational onboarding the first time they sign in. The AI tutor asks about general background (current role, experience, domains the learner knows) and captures it as a free-text bio on the profile. Priority: must-have
  > Socratic: Counter-argument considered: "a single bio textarea on signup would capture the same content with one screen instead of a chat." Resolution: stands — the AI tutor's personality starts here; a textarea is what every other tool does and erodes the differentiator. Bio is captured once and is not per-session overhead.
- FR-006: The learner's profile bio AND the per-session intake params (FR-018) are both used to tailor the generated study experience. Bio sets long-term framing (idiom, default depth); per-session params set this-session pacing, knowledge-level calibration, and topic focus. Priority: must-have
  > Socratic: Counter-argument considered: "tailoring could be placebo if the AI ignores either input." Resolution: stands — both inputs must measurably change the generated prompt (verifiable at prompt level). Bio without per-session params would be too coarse; per-session without bio would lose long-term framing.
- FR-018: At the start of every new session, the AI tutor runs a brief conversational intake that captures (a) knowledge level for the uploaded material, (b) learning goal for this session, and (c) available time. Values are stored on the session, not on the profile. Priority: must-have
  > Socratic: Counter-argument considered: "session-start chat adds friction to every session — a 3-pick form would be faster." Resolution: stands — knowledge level varies per material (e.g. Python senior, Rust beginner), goal varies per sitting, time varies daily; conversational capture lets the tutor probe ambiguity ("30 min — theory only, or theory+exercises?") in a way a form can't. Cost is bounded — 2–3 turns.
- FR-015: A learner can edit their profile bio from the account view outside of an active session. Updates apply to subsequent sessions only — already-completed sessions are not retroactively re-tailored. Per-session params (knowledge level, learning goal, available time) are NOT editable on the profile; they live on each individual session. Priority: must-have
  > Socratic: Counter-argument considered: "if the bio is set in conversational onboarding, why expose a separate edit surface?" Resolution: stands — role / experience / domains change over time (new job, advanced past beginner); forcing a new account or re-onboarding to revise bio would be hostile. Mid-session edit is explicitly out of scope (see Non-Goals).

### Guided learning

- FR-007: A learner is guided step by step through the uploaded material in the chat panel, tailored to their profile and time budget. Priority: must-have
  > Socratic: Counter-argument considered: "a one-shot summary + Q&A is simpler." Resolution: stands — a one-shot summary is what general-purpose chat already does; sequencing IS the differentiating value.
- FR-008: A learner can ask the AI tutor questions about the material at any point in the session. Priority: must-have
  > Socratic: Counter-argument considered: "open Q&A is unbounded and scope-risky." Resolution: stands — a tutor that can't be asked questions isn't a tutor; bound the scope at prompt level rather than removing the FR.

### Exercises

- FR-009: The AI generates exercises (multiple choice, fill-in-the-blank, and at least one domain-specific type) from the uploaded material. Priority: must-have
  > Socratic: Counter-argument considered: "MCQ-only would be much simpler; fill-in-the-blank and domain-specific add real complexity." Resolution: stands — multi-type variety is differentiating; user explicitly accepted the added build cost.
- FR-010: A learner completes exercises and receives immediate per-exercise feedback. Priority: must-have
  > Socratic: Counter-argument considered: "end-of-set feedback would match real exams and be simpler." Resolution: stands — this is study mode, not exam mode; immediate correction is the whole pedagogical point.
- FR-011: A learner sees a performance score after completing the exercise set. Priority: must-have
  > Socratic: Counter-argument considered: "per-topic breakdown would be more useful than a single number." Resolution: stands for MVP — single score IS the readiness signal; per-topic breakdown is v2.

### UI

- FR-012: A learner sees a UI that presents chat (theory + Q&A) and exercises side-by-side on wider screens, collapsing to a tabbed/stacked layout on narrow screens. Priority: must-have
  > Socratic: Counter-argument considered: "split-screen is hostile on smaller laptops." Resolution: demoted from fixed split to responsive layout — side-by-side on wide screens, tabs on narrow.
- FR-013: A learner sees a milestone-style progress indicator showing the session as a sequence of steps (e.g. theory → practice → theory → theory → practice, presented as icons or other visual way), with the current step highlighted. Priority: must-have
  > Socratic: Counter-argument considered: "a generic % bar might lie about position with adaptive content." Resolution: revised — instead of a % bar, use a stepped milestone bar that names each upcoming theory/practice section so the learner sees what's coming and where they are.

### Persistence

- FR-014: A learner's profile, uploaded files, generated materials, exercises, scores, and conversation history are persisted. Priority: must-have
  > Socratic: Counter-argument considered: "persisting full conversation history is expensive." Resolution: stands — needed for score/session history even though mid-session resume is dropped (see Non-Goals).
- FR-016: A learner can delete an individual completed session from their history. The delete removes the session's uploaded files, generated theory and exercises, score, and conversation history. The operation is irreversible and requires explicit confirmation. Priority: must-have
  > Socratic: Counter-argument considered: "delete is sensitive — soft-delete with a 30-day grace period is safer." Resolution: stands as hard-delete with confirmation — single-learner product, no shared state to recover, soft-delete adds shape complexity without a real recovery use case at this scale.

## Non-Functional Requirements

- A learner's uploaded files and session data are visible only to the learner who owns them; no other authenticated learner can access them through any product surface.
- Generated theory content, exercises, and feedback stay grounded in the uploaded material — no facts or claims appear that cannot be traced to the source files.
- A learner sees acknowledgement of any input within ~1 second, and continuous visible progress during any operation that takes longer than 2 seconds.
- Each uploaded file is capped at 20 MB; oversize, unsupported, or corrupted files are rejected with an explanatory error before processing begins.

## Business Logic

Given uploaded study materials, a long-lived learner bio, the session-specific intake (knowledge level for this material, learning goal, available time), and the learner's running answers, the application generates a sequenced study experience — ordered theory steps interleaved with exercises drawn from the uploaded material — and a final performance score.

The rule takes four user-facing inputs: the contents of the uploaded files, the learner's profile bio (captured once at onboarding), the per-session intake params (captured at the start of every session — knowledge level for this material, learning goal, available time), and the learner's running answers during exercises. Its output is the sequence of theory and exercise steps the learner sees, the per-exercise feedback they receive, and the final score that summarizes how well they performed.

The learner encounters the rule continuously: every step in the session — what gets explained next, which exercise comes up, how the score is computed — is the product of this rule. The score is the closing artifact; the sequencing is the live behaviour.

## Access Control

Email + password signup and login. No OAuth, no passwordless, no third-party identity providers in MVP. Flat user model — every signed-in user is a learner; there is no admin role or admin UI in MVP. Unauthenticated users cannot upload files, run a learning session, or access any persisted data; gated routes redirect to login.

## Non-Goals

- **Image extraction from PDFs and AI-generated image fallback.** Cut from MVP scope to keep the build achievable; text-only materials in v1.
- **Mid-session resume.** Sessions are single-sitting. If interrupted, the learner starts a new session — the prior partial session is not resumable.
- **Adaptive exercise sequencing based on performance.** Exercise order is linear and determined at generation time, not adapted from in-session correctness.
- **Multi-session course planning** (breaking content into modules across days/weeks). Each session is self-contained.
- **Mobile app or native UI.** Web only.
- **Sharing or collaboration features.** Single-learner product; no shared sessions, decks, or notes.
- **Import beyond PDF, plain text, and Markdown** (e.g. DOCX, PPTX). Only PDF, `.txt`, and `.md` (as raw text) in MVP. Markdown is NOT rendered or stripped on ingest — the AI sees the raw markdown source.
- **Web scraping or URL-based material ingestion.** Upload only.
- **Spaced-repetition or Anki-style review across sessions.** No long-term retention algorithm in MVP.
- **Premium tier, paid plans, or file-limit upgrades.** Single tier.
- **Integration with external LMSes** (Canvas, Moodle, etc.). No external platform integrations.
- **Mid-session profile or session-param editing.** Profile bio edits apply to the NEXT session. Per-session params (knowledge level, goal, time) are captured at session start (FR-018) and locked for that session — they cannot be changed mid-flow. Avoids the "what happens to in-flight generated content" question entirely.
- **Account deletion (GDPR-style hard delete of the entire account).** Per-session delete (FR-016) covers the privacy case for individual materials. Full account deletion ships in v2.
- **Password reset via email** (forgot-password flow). Password CHANGE with current password (FR-017) is in scope. Users who genuinely forget their password re-register in MVP.

## Open Questions

_No open questions surfaced from shape-notes.md. The quality cross-check ran on 2026-05-17 with status `accepted` — all schema-required elements were captured. Downstream skills (`/10x-tech-stack-selector`, implementation planning) will raise their own questions in their own artifacts._
