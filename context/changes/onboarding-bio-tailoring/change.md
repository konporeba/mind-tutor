---
change_id: onboarding-bio-tailoring
title: One-time conversational onboarding captures a bio reused on every session
status: impl_reviewed
created: 2026-06-09
updated: 2026-06-09
---

## Notes

Roadmap source: S-03 (`context/foundation/roadmap.md`), Stream A (and the join point for Stream C / S-08).

**Outcome:** the first time a learner signs in, a bounded guided-chat onboarding captures a free-text bio (role, experience, domains) once; the bio persists on a new `profiles` row and is injected into every later session's generation prompt, combining with the per-session intake (S-02) to set long-term idiom and default framing. Completes FR-005 and the bio half of FR-006.

**PRD refs:** US-01, FR-005, FR-006 (full — both halves wired after this slice).

**Prerequisites:** S-01 (done — `first-grounded-session`); builds on S-02's generation signature. **Parallel with:** S-02 (done), S-09 (done).

**Key decisions:**
- **Capture UX:** bounded **guided chat** (2–3 scripted tutor turns) with one LLM call to distill answers into the bio — honors FR-005's "AI personality starts here" while reusing the existing one-shot OpenRouter pattern.
- **Bio shape:** single free-text `bio` column (PRD-aligned).
- **Gate:** middleware redirect — not-yet-onboarded authenticated users are forced to `/onboarding`.
- **Bio → generation:** prompt-framing only; does NOT change the deterministic sizing counts (those stay intake-driven).
- **LLM-fail resilience:** on distill failure, store the learner's raw answers as the bio (never hard-block).
- **Null-bio path:** generation omits the bio block entirely (backward-compatible with S-01/S-02 sessions).

**Out of scope:** editing/redoing an existing bio (S-08, `edit-profile-bio`), structured bio fields, multi-type exercises (S-04), mid-session edits (PRD non-goal).
