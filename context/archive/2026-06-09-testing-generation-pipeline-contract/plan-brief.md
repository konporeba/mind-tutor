# Generation Pipeline Contract & Failure Modes — Plan Brief

> Full plan: `context/changes/testing-generation-pipeline-contract/plan.md`
> Research: `context/changes/testing-generation-pipeline-contract/research.md`

## What & Why

Author the test-plan **Phase 1** suite for MindTutor's generation service. It attacks
the two High×High risks at the cheapest layer that gives signal: **Risk #2** (a valid
file + complete intake must never silently fail — it returns a schema-valid session or
a clean recoverable error) and the **structural half of Risk #1** (generated theory is
drawn from the source — every citation maps to a verbatim source span). The semantic
"no off-source claims" judge stays in Phase 4.

## Starting Point

The whole contract lives in one function, `generateSession()`
(`src/lib/services/generation/generate.ts:91`): a pre-flight empty-source guard, a
2-attempt retry loop with five failure branches, and a final throw — every failure
funneled into a typed `GenerationError`. Grounding is a deterministic substring check
(`findUngroundedCitation`, `generate.ts:73`). Today only two tests exist, both on pure
`buildMessages`/sizing; **no test calls `generateSession`**, and the "wired stub" only
resolves the import graph — it does not intercept the network call.

## Desired End State

`npm test` exercises the real parse → validate → ground → retry path with the
OpenRouter edge mocked: a happy path, all six failure modes (each → `GenerationError`),
retry recovery + exhaustion, and structural grounding incl. case/whitespace/truncation
tolerances. The generation cookbook (`test-plan.md` §6.2) documents the pattern so the
next contributor can reproduce it unaided.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Network seam | `vi.mock` the `openrouter` module | One function seam; no production-code change; reaches the real validate/ground path | Research → Plan |
| `GenerationError` under mock | Keep real via `importOriginal` | Tests assert `instanceof`; `getModel` must stay real too | Research |
| Helper home | Shared `src/test/generation/` | Reusable by `distill.ts` (same seam) and Phase 2+ | Plan |
| Route 502 coverage | Defer to Phase 2 | Needs the Astro APIRoute + supabase-mock harness Phase 2 bootstraps | Plan |
| Failure breadth | All 6 modes + retry recovery + exhaustion | Full "never silently fails" contract incl. the subtle retry loop | Plan |
| Grounding depth | Core + tolerance edges | Pins the matcher's real contract (case/whitespace/60k-truncation) | Plan |
| MSW | Not adopted | Overkill for a single-function service seam (resolves §4 open question) | Research |

## Scope

**In scope:** happy-path contract test; 6 failure-mode tests; retry recovery +
exhaustion; structural-grounding tests + tolerances; shared mock/builder helpers;
cookbook §6.1/§6.2/§6.7 fill.

**Out of scope:** re-testing `buildMessages`/prompt wording; route + UI error-surface
tests (Phase 2); semantic off-source judge (Phase 4); MSW; editing the §3 status cell
(orchestrator owns it).

## Architecture / Approach

`vi.mock` the `openrouter` module so `getOpenRouterClient()` returns a fake client whose
`chat.completions.create` is a controllable spy; keep the real `GenerationError` /
`getModel` via `importOriginal`. A sizing-aware completion builder under
`src/test/generation/` produces one known-good session JSON; each failure/grounding
case is a one-line override off that baseline. Tests assert structure, schema-validity,
and grounding — never values lifted from a real model (avoids the oracle problem).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness + happy path | Shared mock + builder + fixture; valid input → schema-valid session | `vi.mock` hoisting / keeping `GenerationError` real |
| 2. Risk #2 failures | 6 modes → `GenerationError`; retry recovery + exhaustion | Over-mocking that skips the real parse/validate branch |
| 3. Risk #1 grounding + cookbook | Grounded/ungrounded + tolerance edges; fill §6.2/§6.7 | Truncation edge needs a >60k source fixture |

**Prerequisites:** none beyond current vitest harness (`vitest.config.ts`) — research is done.
**Estimated effort:** ~1–2 sessions across the 3 phases (one test file + two small helper files).

## Open Risks & Assumptions

- `vi.mock` hoisting: the `create` spy must be created with `vi.hoisted`, and the
  factory must spread `importOriginal()` or `instanceof GenerationError`/`getModel`
  break. Flagged in the plan's Critical Implementation Details.
- The truncation tolerance test needs a `buildLargeSource` (>60k) fixture.
- Assumes the route's clean-502 contract holds *because* the service only ever throws
  `GenerationError`; the suite asserts that type invariant, but the route mapping
  itself is verified in Phase 2.

## Success Criteria (Summary)

- `npm test` green with the happy path, all 6 failure modes, retry recovery/exhaustion,
  and grounding + tolerance cases present.
- A contributor can add a new generation test from `test-plan.md` §6.2 alone.
- Re-running `/10x-test-plan` recognizes Phase 1 as complete.
