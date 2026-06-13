---
change_id: testing-score-and-upload-errors
title: Test score correctness and upload/parse error surfacing (test-plan Phase 3)
status: archived
created: 2026-06-13
updated: 2026-06-13
archived_at: 2026-06-13T20:09:19Z
---

## Notes

Rollout Phase 3 of context/foundation/test-plan.md: "Score correctness + upload/parse error surfacing".
Risks covered: #4 (performance score miscomputed), #5 (upload/parse error not surfaced). Test types planned: unit + integration.
Risk response intent:
- #4: prove the performance score equals an independently-computed percentage correct over a fixture of known answers, aggregating across MCQ (and future exercise types) — not merely that a final number is present.
- #5: prove a corrupt/oversize/unsupported/empty-extraction input yields a clean explanatory error BEFORE generation runs — never a silent break or opaque error.
