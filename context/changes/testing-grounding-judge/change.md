---
change_id: testing-grounding-judge
title: Grounding fidelity LLM-judge — Phase 4 (semantic remainder of Risk #1)
status: implemented
created: 2026-06-13
updated: 2026-06-14
archived_at: null
---

## Notes

Rollout Phase 4 of context/foundation/test-plan.md: "Grounding fidelity (the wedge)".

Risks covered: semantic remainder of Risk #1 (grounding failure — generated theory/exercise/feedback prose contains claims not traceable to the uploaded source).

Test types planned: AI-native LLM-judge.

Risk response intent: prove that every factual claim in generated theory body / exercise / feedback PROSE maps to the source fixture, and off-source claims are flagged — covering the semantic remainder that Phase 1's deterministic, citation-only, 60k-truncated structural check (findUngroundedCitation, theory[].citation only) cannot catch. Must challenge "output looks plausible, therefore it is grounded". Avoid the oracle problem (asserting expected values lifted from the model's own output). This is the most expensive / least deterministic layer and is optional-after per §5 — only assert what a deterministic check cannot already catch for the right reason (§4 "When NOT to use" the judge).
