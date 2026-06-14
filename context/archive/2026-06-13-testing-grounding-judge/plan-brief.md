# Grounding Fidelity LLM-Judge (test-plan Phase 4) — Plan Brief

> Full plan: `context/changes/testing-grounding-judge/plan.md`
> Research: `context/changes/testing-grounding-judge/research.md`

## What & Why

Build an AI-native **grounding judge** that flags factual claims in generated session
prose (theory body/heading, MCQ prompt, the correct option, feedback) not semantically
supported by the uploaded source. This is the **semantic remainder of Risk #1** — the
slice Phase 1's deterministic, citation-only `findUngroundedCitation` structurally cannot
catch. It must challenge "output looks plausible, therefore it is grounded" without the
oracle problem (no asserting values lifted from the model's own output).

## Starting Point

Phase 1 proved structural grounding: `findUngroundedCitation` (`generate.ts:73-82`)
substring-checks `theory[].citation` only, against the 60k-truncated source. All other
prose is unverified. The model-call seam (`getOpenRouterClient`), the parse→zod pattern,
and the integration suite's opt-in/keyed/separate-config machinery all already exist and
are reused. Phase 1's fixtures emit placeholder prose, so they can't exercise a semantic
judge — new fixtures are required.

## Desired End State

`npm test` gains a deterministic unit that proves the judge's wiring (distractor
exemption, verdict parsing, aggregation) with the model stubbed. A new opt-in
`npm run test:livejudge` makes a real model call against hand-authored, labeled adversarial
fixtures and proves the judge FLAGS planted/contradictory/truncated-away claims, PASSES
faithful paraphrases, and does NOT false-flag legitimate distractors. The live suite is
excluded from `npm test`, requires `OPENROUTER_API_KEY`, and fails fast without it.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Judge execution | Live-call only | A real model call against clear-cut fixtures; the user accepted non-determinism. | Research |
| Prose scope | All text fields, distractors exempt | Theory body/heading + MCQ prompt/correct option/feedback; distractors are intentionally off-source. | Research |
| Judge code home | Production lib (`src/lib/services/grounding/`) | Mirrors lib+test split; reusable; tree-shaken out of the worker bundle while unused. | Plan |
| Verdict granularity | Atomic claims, single call | Per-claim `{field, claim, grounded, sourceSpan, reasoning}` array — pinpoints the off-source sentence. | Plan |
| Robustness | Single call, temp 0 + JSON mode | Fixtures are unambiguous by design, so one call suffices — no best-of-N. | Plan |
| Wiring safety net | Yes — deterministic unit | Don't pay a model to test a switch statement; keeps a fast guard in `npm test`. | Plan |
| Judge model | Reuse `OPENROUTER_MODEL` (gpt-4o-mini) | No new env var; temp 0 + json_object is a real determinism lever there (watch-item: shares the generator's model). | Plan |
| CI gate | Name & document, don't wire YAML | CLAUDE.md forbids authoring CI/CD pipelines in this lesson. | Plan |

## Scope

**In scope:** the `grounding/` judge module + verdict schema; a deterministic stubbed-verdict
unit (in `npm test`); hand-authored adversarial fixtures; the live `test:livejudge` suite +
separate vitest config + npm script + real-key stub; test-plan §6.6 cookbook + §6.7 note.

**Out of scope:** re-checking `theory[].citation` (Phase 1 owns it); grading distractors;
the Anthropic SDK (judge calls via OpenRouter, like the rest of the repo); editing
`ci.yml`; any production-path/runtime guardrail; asserting model wording.

## Architecture / Approach

A structure-aware judge in `lib/` separates deterministic glue (which fields to submit,
verdict parse, aggregation) from the non-deterministic model call. It submits the 60k
source slice + a `{field, text}` claim set (distractors omitted, correct option resolved
from `correctIndex`) and asks the model to mark each claim grounded/not, returning a
zod-validated JSON verdict via the existing `getOpenRouterClient` seam (`temperature: 0`,
`response_format: json_object`). The deterministic unit stubs that seam; the live suite
hits the real model and is gated behind a separate config + key, cloning the integration
suite's opt-in/fail-fast pattern.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Judge core + deterministic wiring | `grounding/` module (schema, distractor-aware payload, single-call judge) + stubbed-verdict unit in `npm test` | Getting the distractor-exemption + verdict-parse contract right |
| 2. Fixtures + live keyed suite + docs | Hand-labeled fixtures, `test:livejudge` (separate config/script/real-key stub, excluded from `npm test`), §6.6/§6.7 docs | Fixture clarity (single live call must be stable); reused-model independence caveat |

**Prerequisites:** local `OPENROUTER_API_KEY` (in `.env`/`.dev.vars`) to run the live
suite; Phase 1 harness reuse (mock seam, integration-config pattern) already in place.
**Estimated effort:** ~2 sessions across 2 phases.

## Open Risks & Assumptions

- **Reused model = shared blind spot.** Judge runs on the generator's own model
  (gpt-4o-mini); it may miss in production what the generator also misses. Mitigated for
  the *test* by hand-labeled fixtures (the oracle is ours); recorded as a §6.7/§7
  watch-item; `JUDGE` model is a one-line change for a future cross-family phase.
- **Single-call stability.** A borderline fixture could flake; mitigated by authoring
  unambiguous PASS/FLAG fixtures. Escalate to best-of-N only if flakes appear.
- **Truncation correctness.** The judge must ground against the 60k slice, not full text,
  or it passes truncated-away claims — pinned by a dedicated fixture.

## Success Criteria (Summary)

- `npm test` stays green, network/key-free, and now guards the judge's deterministic glue.
- With a key, `npm run test:livejudge` flags planted/contradictory/truncated-away claims,
  passes faithful paraphrases, and never flags a legitimate distractor.
- Without a key, the live suite fails fast (not silently green); §6.6/§6.7 documented.
