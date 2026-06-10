---
change_id: testing-cross-learner-isolation
title: Cross-learner isolation across the session API (Risk #3, IDOR)
status: impl_reviewed
created: 2026-06-10
updated: 2026-06-10
archived_at: null
---

## Notes

Rollout Phase 2 of context/foundation/test-plan.md: "Cross-learner isolation across the session API".
Risks covered: #3 (cross-learner isolation / IDOR — a learner reads or mutates another learner's session, materials, exercises, or score through the API by guessing IDs).
Test types planned: integration (second authenticated identity) + server-side validation.
Risk response intent: prove that a non-owner receives 403/404 (not data) on every session-scoped read AND mutation endpoint — never assert only that the owner CAN read; the failing assertion is that the non-owner is denied.
After creating the folder, follow the downstream continuation rule (suggest /10x-research next).
