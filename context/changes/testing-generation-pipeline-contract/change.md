---
change_id: testing-generation-pipeline-contract
title: Generation pipeline contract & failure modes (test rollout Phase 1)
status: implemented
created: 2026-06-09
updated: 2026-06-10
archived_at: null
---

## Notes

Rollout Phase 1 of context/foundation/test-plan.md: "Generation pipeline contract & failure modes".
Risks covered: #2 (generation pipeline silently fails on valid input), and the structural part of #1 (generated content drawn from the source).
Test types planned: unit + integration with the OpenRouter edge stubbed (stub already wired in vitest.config.ts).
Risk response intent:
- Risk #2: prove that given a valid source + complete intake, the generation service returns schema-valid output OR a clean recoverable error the route/UI can surface - never a silent break.
- Risk #1 (structural only): prove generated theory/exercises are structurally drawn from the provided source fixture (claims map to source spans); the semantic "no off-source claims" judge is deferred to Phase 4.
