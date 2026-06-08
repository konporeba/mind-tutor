---
change_id: per-session-intake-tailoring
title: Per-session intake (knowledge level, goal, time) biases generation
status: implemented
created: 2026-06-08
updated: 2026-06-08
archived_at: null
---

## Notes

Roadmap source: S-02 (`context/foundation/roadmap.md`), Stream A.

**Outcome:** at the start of a new session, capture a brief intake — knowledge level for the uploaded material, learning goal, and available time — that measurably biases the generated theory and exercise depth/pacing. Values are stored on the session (not the profile).

**PRD refs:** US-01, FR-018, FR-006 (partial — per-session params half; the bio half lands in S-03).

**Prerequisites:** S-01 (done — `first-grounded-session`). **Parallel with:** S-03, S-09.

**Key decision — intake UX:** ships as a **structured 3-field form**, a conscious MVP scoping call that diverges from FR-018's explicit "conversational (2–3 turns)" decision (top blocker = time, goal = market-feedback). Conversational intake is a documented fast-follow.

**Out of scope:** profile bio (S-03), the bio half of FR-006, multi-type exercises (S-04), mid-session edits (PRD non-goal).
