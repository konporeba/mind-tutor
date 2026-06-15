---
change_id: multi-type-exercises
title: Multi-type exercises — add fill-in-the-blank and matching-pairs alongside MCQ
status: archived
created: 2026-06-14
updated: 2026-06-15
archived_at: 2026-06-15T17:50:19Z
---

## Notes

Roadmap slice **S-04** (`multi-type-exercises`), Stream A. Completes FR-009 (full) — replaces the MCQ-only partial shipped in S-01.

Outcome: the per-session exercise set includes **fill-in-the-blank** and **matching pairs** alongside MCQ; the score still aggregates correctly across all three types.

Third-type decision (user, 2026-06-14): **matching pairs** (match terms to definitions/concepts drawn from the source). Chosen for deterministic scoring (no LLM grader in the score path), cross-domain robustness, and lowest grounding risk — the pragmatic reading of "domain-specific" for the MVP.

Load-bearing risks to resolve in planning:
- Score aggregation across three heterogeneous types.
- Matching-pairs UI + scoring.
- Prompt-level reliability of generating valid pairs from arbitrary uploaded sources (don't amplify S-01 grounding bugs).
