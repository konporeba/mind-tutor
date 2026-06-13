# Grounding Fidelity LLM-Judge (test-plan Phase 4) Implementation Plan

## Overview

Build an **AI-native grounding judge** that detects factual claims in generated session
*prose* — theory body/heading, MCQ prompt, the correct option, and feedback — that are
not semantically supported by the uploaded source. This is the **semantic remainder of
Risk #1**: the slice Phase 1's deterministic `findUngroundedCitation`
(`src/lib/services/generation/generate.ts:73-82`, `theory[].citation` only, substring
match) structurally cannot reach. The judge makes a **live** model call and is asserted
against **hand-authored adversarial fixtures** whose PASS/FLAG labels are the oracle —
never the model's own output (the §2 oracle anti-pattern).

The work splits in two: a **deterministic core** (the judge module + a stubbed-verdict
unit that runs in default `npm test`) and an **opt-in live keyed suite** (real model
call against the fixtures, excluded from `npm test`, mirroring the integration suite's
separate-config pattern).

## Current State Analysis

- **The semantic remainder is the complement of one substring check.**
  `findUngroundedCitation` validates `theory[].citation` only, against the 60k-truncated
  source slice (`MAX_SOURCE_CHARS = 60_000`, `generate.ts:17,100`). Every other string
  field — `theory[].body`/`heading`, `exercises[].prompt`, the correct option,
  `exercises[].feedback`, `title` — is unverified for grounding (`schema.ts:22-47`).
- **Distractors are intentionally off-source.** `exercises[].options[i]` for
  `i != correctIndex` are plausible-but-wrong by construction; the correct answer is
  `options[correctIndex]` (`schema.ts:35`, persisted as `correct_answer = options[correctIndex]`,
  `src/pages/api/sessions/index.ts:158`). A judge that requires every option to be
  grounded would false-flag every good distractor. **The judge must be structure-aware.**
- **The model-call seam already exists.** `getOpenRouterClient()` / `getModel()`
  (`src/lib/services/generation/openrouter.ts:21-34`) is the single seam; the
  generation service calls `client.chat.completions.create({ model, messages,
  response_format: { type: "json_object" }, temperature, max_tokens })`
  (`generate.ts:117-123`) then `JSON.parse` + zod `safeParse` (`generate.ts:136-147`).
  The judge mirrors this call+parse shape.
- **The integration suite is the template** for an opt-in, keyed, out-of-default suite:
  separate `vitest.integration.config.ts`, a `test:integration` script
  (`package.json:18`), `*.integration.test.ts` excluded from the default run
  (`vitest.config.ts:22`), and a stub that injects real credentials with fail-fast
  (`src/test/integration/env.ts:11-24`, `src/test/stubs/astro-env-server.integration.ts`).
- **Phase 1 fixtures cannot exercise a semantic judge.** `buildValidSession`
  (`src/test/generation/completion-builder.ts:68-90`) emits placeholder prose
  ("Explanation for step 1.", "Question 1?", "Feedback for question 1.") — no real claim
  to confirm and nowhere to plant a hallucination. Phase 4 authors new fixtures.

See `context/changes/testing-grounding-judge/research.md` for the full file:line map.

## Desired End State

- A reusable `src/lib/services/grounding/` module exposes a judge that, given a
  `GeneratedSession` and the source string, returns a structured verdict: a list of
  atomic claims drawn from the gradable prose, each marked grounded or not, plus an
  overall pass/fail. Distractors are never submitted for grounding.
- `npm test` includes a **deterministic** unit proving the judge's wiring (payload
  excludes distractors, verdict parses, aggregation is correct, a malformed model
  response is handled) — with the model call stubbed, no network, no key.
- `npm run test:livejudge` runs a **real** model call against the adversarial fixtures
  and proves: planted off-source/contradictory claims are FLAGGED, faithful paraphrases
  PASS, a claim grounded only in truncated-away text is FLAGGED, and a legitimate
  distractor is NOT flagged. It is excluded from `npm test`, requires
  `OPENROUTER_API_KEY`, and fails fast with a clear message when the key is absent.
- test-plan §6.6 documents the pattern and its "When NOT to use" boundary; §6.7 carries
  a Phase 4 note.

**Verification:** `npm test` stays green and Supabase/network-free; `npm run lint` and
`astro check` pass; with a real key, `npm run test:livejudge` passes against the fixtures;
without a key it fails fast (not silently green).

### Key Discoveries:

- Grounding corpus = the **same 60k-truncated slice** the generator saw
  (`generate.ts:100,110`), reconstructable as `extracted_text.trim().slice(0, 60_000)`.
  Grounding against full text would wrongly pass claims supported only by truncated-away
  content. Fixtures must exercise this edge (`completion-builder.ts:100-111` is the
  Phase 1 precedent for a >60k source).
- The correct option is identifiable pre-persistence via `correctIndex`
  (`schema.ts:35`) — the judge resolves it in-memory from the `GeneratedSession`.
- Reusing `OPENROUTER_MODEL` (gpt-4o-mini, the generator's model) means
  `temperature: 0` + `response_format: { type: "json_object" }` is a real determinism
  lever (natively supported), unlike a Claude 4.x judge where temperature is a no-op.
- The existing mock seam (`src/test/generation/openrouter-mock.ts` `fakeOpenRouterClient`
  / `makeCompletion`) is reusable for the deterministic unit's stubbed verdict.

## What We're NOT Doing

- **Not** re-checking `theory[].citation` literal occurrence — that is
  `findUngroundedCitation`'s job and re-checking it violates §4 "When NOT to use the
  judge". The judge owns only the *semantic* support of the remaining prose.
- **Not** grading MCQ distractors for grounding (intentionally off-source by design).
- **Not** using the Anthropic SDK. The repo reaches every model through
  `getOpenRouterClient()` (the `openai` SDK pointed at OpenRouter); the judge reuses that
  seam and calls the model via OpenRouter's OpenAI-compatible endpoint, consistent with
  `generate.ts` / `distill.ts`.
- **Not** editing `.github/workflows/ci.yml`. The plan names and documents the optional
  CI gate (OPENROUTER_API_KEY secret + a conditional step) but does not author CI YAML
  (CLAUDE.md "Do not author CI/CD pipelines"; out of this lesson's scope).
- **Not** wiring the judge into the production generation path (no runtime guardrail).
  It is a test-layer asset that happens to live in `lib/` for reuse; it is never imported
  by `src/pages/**`.
- **Not** asserting the model's exact wording (§7) or any expected value lifted from the
  judge's own output.

## Implementation Approach

A structure-aware judge in `lib/` keeps the deterministic glue (which fields to submit,
verdict parsing, aggregation) separable from the non-deterministic model call, so the
glue is provable in `npm test` while discrimination is proved by the live suite. The
judge submits the source slice plus a structured set of `{field, text}` claims (distractors
omitted) and asks the model to return, for each, whether the source supports it. Determinism
is bought with `temperature: 0` + JSON mode and unambiguous fixtures, not voting. The live
suite clones the integration suite's separate-config/opt-in/fail-fast machinery so a keyed,
paid, non-deterministic test never runs under `npm test`.

## Critical Implementation Details

- **Distractor exemption is in what we submit, not what the model decides.** The judge's
  payload builder resolves `options[correctIndex]` and submits only prompt + correct
  option + feedback + theory body/heading. Never send the other options as
  grounding targets — the model would dutifully flag them.
- **Ground against the truncated slice.** The judge must receive
  `source.trim().slice(0, 60_000)` (the same text `buildMessages` sent), not the full
  material, or it will pass claims grounded only in truncated-away text. The fixture
  suite includes a case that pins this.
- **Reused model ⇒ shared-blind-spot watch-item.** Because `OPENROUTER_MODEL` is the
  generator's own model, the judge could share a blind spot with the generator on *real*
  production output. The live suite stays meaningful because its fixtures are
  hand-authored with known labels (the oracle is ours), but record this independence
  limit in §6.7 and §7 as a watch-item, and keep `JUDGE` model selection a one-line
  change should a future phase want cross-family independence.

## Phase 1: Judge core + deterministic wiring

### Overview

Create the `grounding/` module — verdict schema, distractor-aware payload builder,
single-call judge over the existing seam — and a deterministic unit that proves the
wiring with the model call stubbed. Lands in default `npm test`.

### Changes Required:

#### 1. Verdict schema

**File**: `src/lib/services/grounding/schema.ts`

**Intent**: Define the zod shape the judge validates the model's JSON response against, so
a malformed or off-contract verdict is a clean typed failure rather than a silent pass —
mirroring how `generation/schema.ts` is the single source of truth for generated output.

**Contract**: A `GroundingVerdictSchema` (zod) validating a single-call response: an array
of per-claim verdicts plus a derived/overall flag. Each claim carries the field it came
from, the claim text, a boolean `grounded`, an optional supporting `sourceSpan` (string |
null), and a short `reasoning`. Export the inferred type. Shape:

```ts
// one entry per atomic claim the judge extracted from the submitted prose
const ClaimVerdict = z.object({
  field: z.enum(["theory.body", "theory.heading", "mcq.prompt", "mcq.correctOption", "mcq.feedback", "title"]),
  claim: z.string().min(1),
  grounded: z.boolean(),
  sourceSpan: z.string().nullable(),
  reasoning: z.string().min(1),
});
export const GroundingVerdictSchema = z.object({ claims: z.array(ClaimVerdict) });
```

#### 2. Distractor-aware payload builder + judge prompt

**File**: `src/lib/services/grounding/judge.ts`

**Intent**: Turn a `GeneratedSession` + source into the exact claim set the model must
grade (excluding distractors), build the judge messages (invert the generator's grounding
instruction — "verify each claim is supported by the source; flag anything not"), and
expose the prompt builder as a pure, separately-testable function.

**Contract**: A pure `buildGroundingClaims(session): { field, text }[]` that emits
theory body + heading, MCQ prompt, `options[correctIndex]` (tagged `mcq.correctOption`),
and feedback — and **never** the non-correct options. A pure
`buildJudgeMessages(sourceSlice, claims)` returning the `messages` array. The system
message instructs: ground each claim against ONLY the provided source; a claim is
ungrounded if the source does not support it; return the verdict JSON. No snippet needed
beyond the field-set rule above.

#### 3. The judge call + aggregation

**File**: `src/lib/services/grounding/judge.ts` (same module)

**Intent**: Make the single live model call through the existing seam, parse + zod-validate
the verdict, and aggregate to an overall result — adopting the generation service's
parse-then-validate discipline and throw-on-failure posture (not `distill.ts`'s silent
fallback).

**Contract**: `judgeGrounding(session, source): Promise<GroundingResult>` that: truncates
`source` to 60k; builds claims + messages; calls
`getOpenRouterClient().chat.completions.create({ model: getModel(), messages,
response_format: { type: "json_object" }, temperature: 0, max_tokens })`; `JSON.parse` +
`GroundingVerdictSchema.safeParse`; throws a typed `GroundingError` (new, exported from
this module) on empty/invalid-JSON/schema-invalid response. `GroundingResult` exposes the
validated `claims` plus `ungrounded` (the subset with `grounded === false`) and a boolean
`allGrounded`. Reuse `temperature: 0` (real lever on gpt-4o-mini) for reproducibility.

#### 4. Deterministic wiring unit

**File**: `src/lib/services/grounding/judge.test.ts`

**Intent**: Prove the judge's deterministic glue with the model call stubbed — no network,
no key — so a parsing/exemption/aggregation bug can't hide behind model variance, and the
guard stays in default `npm test`.

**Contract**: `vi.mock` the `openrouter` seam (reuse `fakeOpenRouterClient` / `makeCompletion`
from `src/test/generation/openrouter-mock.ts`, spreading `importOriginal` to keep the real
`getModel`). Assert: (a) `buildGroundingClaims` excludes every non-correct option and
includes the correct one + prompt + feedback + theory body/heading; (b) a canned valid
verdict parses and aggregates (`ungrounded`/`allGrounded` correct); (c) a canned verdict
with one `grounded: false` surfaces in `ungrounded`; (d) a non-JSON / schema-invalid
canned response throws `GroundingError`. Co-located `*.test.ts`, runs under `npm test`.

### Success Criteria:

#### Automated Verification:

- [ ] Unit tests pass: `npm test`
- [ ] Type checking passes: `astro check` (or `npm run build`)
- [ ] Linting passes: `npm run lint`
- [ ] `npm test` makes no network call and requires no `OPENROUTER_API_KEY` (the unit stubs the seam)

#### Manual Verification:

- [ ] `judge.ts` is imported only by tests — confirm no `src/pages/**` import (grep), so it stays out of the worker bundle
- [ ] Verdict schema + claim-set rule read as the intended contract (distractors excluded; citation not re-graded)

**Implementation Note**: After Phase 1 passes automated verification, pause for manual
confirmation before Phase 2.

---

## Phase 2: Adversarial fixtures + live keyed suite + docs

### Overview

Author the hand-labeled fixtures, the live `test:livejudge` suite that calls the real
model against them, the separate config/script/stub that keeps it opt-in and out of
`npm test`, and the test-plan cookbook + phase note.

### Changes Required:

#### 1. Adversarial fixtures

**File**: `src/test/grounding/fixtures.ts`

**Intent**: Provide a hand-authored source plus several `GeneratedSession`s whose prose
carries author-labeled claims, so the live suite asserts the judge against our oracle, not
the model's own output. Richer than `SMALL_SOURCE` only insofar as real paraphrasable
claims require it.

**Contract**: Export a `GROUNDING_SOURCE` (self-contained passage with enumerable facts)
and labeled session fixtures covering: a **faithful-paraphrase** session (all prose
supported, reworded so it tests semantics not substring → must PASS); a **planted-off-source**
session (a `body`/`feedback`/`prompt` sentence stating a fact absent from or contradicting
the source → must FLAG, with the offending field labeled); a **truncation-edge** session
whose claim is supported only beyond 60k (build via the `buildLargeSource` pattern,
`completion-builder.ts:100-111` → must FLAG); and a **legitimate-distractor** control
(correct option + prose grounded; distractors plausibly wrong → judge must NOT flag the
distractors). Each fixture's expected PASS/FLAG set is authored by us.

#### 2. Live judge suite

**File**: `src/lib/services/grounding/judge.livejudge.test.ts`

**Intent**: Exercise the real judge against the fixtures and assert discrimination,
tolerating non-determinism via clear-cut fixtures (the user's "live-call only" choice).

**Contract**: For each fixture, call the real `judgeGrounding(session, source)` (no seam
mock) and assert the `ungrounded` set matches the authored label: faithful → empty;
planted → contains the labeled field's claim; truncation-edge → flagged; distractor
control → no distractor appears in `ungrounded` (and the correct option is not falsely
flagged). Uses the `*.livejudge.test.ts` suffix so the default config excludes it.

#### 3. Separate config + script + real-key stub

**File**: `vitest.livejudge.config.ts`, `package.json`, `src/test/stubs/astro-env-server.livejudge.ts`, `vitest.config.ts`

**Intent**: Clone the integration suite's opt-in machinery so the keyed, paid,
non-deterministic suite never runs under `npm test` and fails fast without a key.

**Contract**: `vitest.livejudge.config.ts` includes only `src/**/*.livejudge.test.ts` and
aliases `astro:env/server` to the new stub. The stub exports a **real** `OPENROUTER_API_KEY`
read from `process.env` (and `OPENROUTER_MODEL` with the same default), with a fail-fast
`required()`-style throw naming the fix when the key is absent (mirror
`src/test/integration/env.ts:11-24`). `package.json` adds `"test:livejudge": "vitest run
--config vitest.livejudge.config.ts"`. `vitest.config.ts` `exclude` gains
`**/*.livejudge.test.ts` so the default suite ignores it.

#### 4. Cookbook + phase note

**File**: `context/foundation/test-plan.md`

**Intent**: Fill the §6.6 TBD slot with the judge pattern and its boundary, and add the
§6.7 Phase 4 note — so the next contributor continues the pattern rather than restating it.

**Contract**: Replace §6.6's "TBD" with: the judge's location/naming, the
distractor-exemption rule, the grounding-against-the-60k-slice rule, the
fixtures-are-the-oracle discipline, the `npm run test:livejudge` opt-in/keyed nature, and
the §4 "When NOT to use" boundary (do not re-grade what `findUngroundedCitation` already
covers). Add a §6.7 bullet noting the deterministic-core/live-suite split, the reused-model
independence watch-item, and the optional CI gate (OPENROUTER_API_KEY secret + conditional
step) that this change documents but does not wire.

### Success Criteria:

#### Automated Verification:

- [ ] `npm test` still passes and still excludes the live suite (no network/key needed)
- [ ] Linting passes: `npm run lint`
- [ ] Type checking passes: `astro check`
- [ ] With `OPENROUTER_API_KEY` set: `npm run test:livejudge` passes against all fixtures
- [ ] Without `OPENROUTER_API_KEY`: `npm run test:livejudge` fails fast with a clear message (not silently green)

#### Manual Verification:

- [ ] Each fixture's PASS/FLAG outcome matches its authored label across a couple of live runs (stability check on the single-call approach)
- [ ] The legitimate-distractor control does not get flagged (no false positives on intentional off-source distractors)
- [ ] test-plan §6.6 reads as a usable cookbook entry and §6.7 records the independence watch-item

**Implementation Note**: After Phase 2 passes automated verification, run the live suite
twice to confirm fixture stability before considering the phase complete.

---

## Testing Strategy

### Unit Tests:

- Deterministic wiring (`judge.test.ts`): claim-set excludes distractors; verdict parse;
  aggregation; malformed-response throws — model call stubbed, runs in `npm test`.

### Integration Tests:

- Live judge (`judge.livejudge.test.ts`): real model call against hand-labeled fixtures;
  asserts FLAG on planted/contradictory/truncated-away claims, PASS on faithful prose, and
  no false flag on legitimate distractors. Opt-in, keyed, excluded from `npm test`.

### Manual Testing Steps:

1. `npm test` — green, no network, no key.
2. Set `OPENROUTER_API_KEY` in `.env`/`.dev.vars`; `npm run test:livejudge` — green.
3. Unset the key; `npm run test:livejudge` — fails fast with the named fix.
4. Re-run the live suite once more to confirm fixture stability across runs.

## Performance Considerations

The live suite makes one model call per fixture; keep the fixture set small and
unambiguous so a single `temperature: 0` call per fixture is stable without voting. Default
`npm test` adds only the stubbed unit (negligible).

## Migration Notes

None — additive. No schema, DB, or production-path changes.

## References

- Related research: `context/changes/testing-grounding-judge/research.md`
- Structural Phase 1 grounding: `src/lib/services/generation/generate.ts:73-82` (`findUngroundedCitation`)
- Model-call seam + parse pattern: `src/lib/services/generation/openrouter.ts:21-34`, `generate.ts:117-147`
- Mock seam to reuse: `src/test/generation/openrouter-mock.ts`
- Opt-in keyed-suite template: `vitest.integration.config.ts`, `src/test/integration/env.ts:11-24`, `src/test/stubs/astro-env-server.integration.ts`, `package.json:18`
- Prose surfaces + distractor rule: `src/lib/services/generation/schema.ts:22-47`, `src/pages/api/sessions/index.ts:158`
- test-plan: §2 Risk #1 + Risk Response, §4 "When NOT to use", §5 optional gate, §6.6 (TBD slot to fill), §6.7

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Judge core + deterministic wiring

#### Automated

- [x] 1.1 Unit tests pass: `npm test`
- [x] 1.2 Type checking passes: `astro check` (or `npm run build`)
- [x] 1.3 Linting passes: `npm run lint`
- [x] 1.4 `npm test` makes no network call and requires no `OPENROUTER_API_KEY`

#### Manual

- [x] 1.5 `judge.ts` imported only by tests (no `src/pages/**` import)
- [x] 1.6 Verdict schema + claim-set rule read as the intended contract (distractors excluded; citation not re-graded)

### Phase 2: Adversarial fixtures + live keyed suite + docs

#### Automated

- [ ] 2.1 `npm test` still passes and still excludes the live suite
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Type checking passes: `astro check`
- [ ] 2.4 With `OPENROUTER_API_KEY` set: `npm run test:livejudge` passes against all fixtures
- [ ] 2.5 Without `OPENROUTER_API_KEY`: `npm run test:livejudge` fails fast with a clear message

#### Manual

- [ ] 2.6 Each fixture's PASS/FLAG outcome matches its authored label across a couple of live runs
- [ ] 2.7 The legitimate-distractor control does not get flagged
- [ ] 2.8 test-plan §6.6 reads as a usable cookbook entry and §6.7 records the independence watch-item
