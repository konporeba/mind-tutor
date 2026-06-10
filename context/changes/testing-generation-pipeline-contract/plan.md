# Generation Pipeline Contract & Failure Modes — Implementation Plan

## Overview

Author the test-plan **Phase 1** suite for MindTutor's generation service. The
suite proves two top risks at the cheapest layer that gives real signal:

- **Risk #2** — given a valid source + complete intake, `generateSession()` returns
  a schema-valid session **or** throws a typed `GenerationError` for every failure
  mode — never a silent break or a partial object.
- **Risk #1 (structural only)** — generated theory is structurally drawn from the
  source: every `theory[].citation` is a verbatim (whitespace-normalized,
  case-insensitive) span of the source actually sent. The semantic "no off-source
  claims in prose" judge is deferred to Phase 4.

All tests run against the real `generateSession()` with only the OpenRouter network
edge mocked, so the real JSON-parse → zod-validate → citation-check → retry path is
exercised end-to-end.

## Current State Analysis

- The contract lives in one function: `generateSession()`
  (`src/lib/services/generation/generate.ts:91`). It owns a pre-flight empty-source
  guard (`generate.ts:96-99`), a `MAX_ATTEMPTS = 2` retry loop (`generate.ts:18,114`)
  with five in-loop failure branches (`generate.ts:116-153`), and a final throw after
  exhaustion (`generate.ts:158`). Every failure converges on `GenerationError`
  (`openrouter.ts:12-17`).
- Structural grounding is `findUngroundedCitation()` (`generate.ts:73-82`): collapses
  whitespace, lowercases both sides, asserts each `theory[].citation` is a substring
  of the source. Validated against the **60k-truncated slice** (`generate.ts:17,100`),
  not the full input.
- The OpenRouter boundary is a single seam: `getOpenRouterClient()`
  (`openrouter.ts:21-29`) returns an `OpenAI` client; `generate.ts:117-124` calls
  `client.chat.completions.create({...})` and reads `completion.choices[0]?.message?.content`.
- The validation schema is **sizing-derived**: `makeGeneratedSessionSchema(sizing)`
  (`schema.ts:54-60`) sets theory bounds and exact MCQ count from
  `COUNTS_BY_BUDGET` (`sizing.ts:25-29`). A "valid" fixture must match the chosen
  intake's bounds or it fails schema validation.
- **The "wired stub" is only an import-resolution stub.** `vitest.config.ts:13`
  aliases `astro:env/server` to `src/test/stubs/astro-env-server.ts`, which exports
  dummy `OPENROUTER_API_KEY="test-key"` / `OPENROUTER_MODEL="test-model"`. This makes
  the import graph resolve and `getOpenRouterClient()` succeed — it does **not**
  intercept the network call. The two existing tests (`generate.test.ts`,
  `sizing.test.ts`) only exercise pure `buildMessages` / `sizeFromIntake`; neither
  calls `generateSession`.
- Tests co-locate as `*.test.ts`; `vitest.config.ts:18` includes `src/**/*.test.ts`;
  `npm test` = `vitest run`. openai `^6.42.0`, zod `^4.4.3`, vitest `^4.1.8`.

## Desired End State

A new test file `src/lib/services/generation/generate.session.test.ts` plus shared
helpers under `src/test/generation/`. Running `npm test` exercises:

1. Happy path — valid source + intake → schema-valid session.
2. All 6 failure modes → `GenerationError` (verified by type, not just message).
3. Retry semantics — bad-attempt-1 → good-attempt-2 recovers; two failures throw
   after exactly `MAX_ATTEMPTS` calls.
4. Structural grounding — grounded → pass; ungrounded → `GenerationError`; plus the
   case-insensitive, whitespace-normalization, and 60k-truncation tolerance edges.

The generation cookbook (`test-plan.md` §6.1/§6.2) documents how to add such tests,
and §6.7 carries a short per-phase note. Verify by: `npm test` green with the new
cases present, and `npm run lint` clean.

### Key Discoveries:

- One function, one seam — `generateSession()` reached through `getOpenRouterClient()`
  (`generate.ts:91`, `openrouter.ts:21`). `vi.mock` of the `openrouter` module is the
  cheapest way to script completions and drive every branch.
- **`GenerationError` must survive the mock.** `generate.ts:12` imports
  `GenerationError`, `getModel`, `getOpenRouterClient` from `./openrouter`, and the
  tests assert `instanceof GenerationError`. The mock factory must keep the real
  `GenerationError` and `getModel` (via `importOriginal`) and override only
  `getOpenRouterClient` — otherwise `instanceof` breaks and `getModel()` returns
  undefined.
- Fixtures must respect the sizing coupling (`sizing.ts:25-29`): budget `30` →
  theory 3–4, exactly 5 MCQs.
- The empty-source guard throws **before** any client call (`generate.ts:96-99`), so
  that case needs no completion script.

## What We're NOT Doing

- **Not** re-testing `buildMessages` / prompt wording — already covered by
  `generate.test.ts`. Phase 1 targets runtime contract + grounding only.
- **Not** asserting exact LLM output wording (test-plan §7) — fixtures assert
  structure, schema-validity, and citation-grounding, never verbatim model prose.
- **Not** testing the route's `GenerationError → 502` mapping or the UI error surface
  — that needs the Astro APIRoute + supabase-mock harness that **Phase 2** bootstraps
  (test-plan §3/§4). Phase 1 stays at the service layer.
- **Not** adopting MSW — a single-function service seam doesn't warrant it (resolves
  the §4 open question; recorded in §6.2).
- **Not** the semantic "off-source claims in `body`/`feedback`" judge — that is the
  Phase 4 LLM-judge layer.
- **Not** editing the `test-plan.md` §3 status cell ourselves — the orchestrator flips
  that to `complete` when this plan is fully checked off (re-invoke `/10x-test-plan`).

## Implementation Approach

Build the reusable harness first (Phase 1), so the happy path proves the seam works
before layering the failure and grounding suites on top (Phases 2–3). The completion
builder is parameterized so each failure mode is a small override of one valid
baseline, keeping the suite readable and resistant to the oracle problem (we assert
*structure and grounding*, never values lifted from a real model). Helpers live in
`src/test/generation/` so `distill.ts` (same `getOpenRouterClient` seam) and Phase 2+
can reuse them.

## Critical Implementation Details

- **`vi.mock` hoisting + real `GenerationError`.** `vi.mock` is hoisted above imports,
  so the controllable `create` spy must be created with `vi.hoisted` (or referenced
  via a mock-module the factory imports). The factory must spread `importOriginal()`
  so `GenerationError` and `getModel` stay real and `getOpenRouterClient` returns the
  fake client. The fake client only needs the shape the code reads:
  `{ chat: { completions: { create } } }` where `create` resolves to
  `{ choices: [{ message: { content } }] }`.
- **Truncation edge needs a >60k source.** To exercise `generate.ts:100`, the
  grounding fixture must place the only occurrence of a citation span *after* the
  first 60,000 chars; the builder needs a `buildLargeSource` helper that pads to a
  target length with the cited span beyond the cap.

---

## Phase 1: Shared test harness + happy-path contract

### Overview

Stand up the reusable OpenRouter mock, the sizing-aware valid-completion builder, and
the source fixture; prove the seam end-to-end with the happy-path test.

### Changes Required:

#### 1. OpenRouter mock helper

**File**: `src/test/generation/openrouter-mock.ts`

**Intent**: Provide a reusable way to script `client.chat.completions.create` so any
test (this phase and later, incl. `distill.ts`) can drive the generation service
without network. Owns the hoisted `create` spy and the `vi.mock` factory wiring that
preserves the real `GenerationError`/`getModel`.

**Contract**: Exports a hoisted `create` spy (`vi.fn`), a `makeCompletion(content: string | null)` →
`{ choices: [{ message: { content } }] }` wrapper, and a factory usable as the
`vi.mock("@/lib/services/generation/openrouter", factory)` argument that returns
`{ ...actual, getOpenRouterClient: () => ({ chat: { completions: { create } } }) }`
with `actual = await importOriginal()`. The test file calls `vi.mock` at top level;
mechanics use `vi.hoisted` so the spy is referenceable inside the hoisted factory.

#### 2. Valid-completion builder + fixtures

**File**: `src/test/generation/completion-builder.ts` (+ source fixture, here or in a sibling `source-fixture.ts`)

**Intent**: Produce a schema-valid generated-session JSON string for a given intake's
sizing, plus a small library of single-field overrides/mutators for each failure mode
and grounding case. Centralizes the "what a valid session looks like" knowledge so
failure cases are one-line deltas off a known-good baseline.

**Contract**: `buildValidSessionJson(source, intake, overrides?)` returns a JSON
string with `title`, `theory[]` (count within `sizeFromIntake(intake)` bounds, each
`citation` a verbatim substring of `source`), `exercises[]` (exactly `mcqCount`,
`options` length 3–5, valid `correctIndex`). A `SMALL_SOURCE` fixture string and a
`buildLargeSource(targetChars, citedSpan)` helper (cited span placed beyond 60k for
the truncation edge). Default intake fixture: `{ knowledgeLevel: "intermediate",
learningGoal: "learn the basics", timeBudgetMinutes: 30 }`.

#### 3. Happy-path contract test

**File**: `src/lib/services/generation/generate.session.test.ts`

**Intent**: Prove the mock seam works and the contract's success path holds: a valid
source + intake yields a schema-valid `GeneratedSession`. Establishes the file the
later phases extend.

**Contract**: `vi.mock` the `openrouter` module via the Phase-1 factory; script
`create` to resolve the builder's valid JSON; assert `generateSession(SMALL_SOURCE,
intake)` resolves to an object satisfying `GeneratedSessionSchema`/the sizing bounds
(title non-empty, theory count in range, exactly `mcqCount` exercises, every
`correctIndex < options.length`). Assert `create` called once. Include a with-bio and
without-bio happy-path pair (bio param is accepted; behavior already prompt-tested
elsewhere — here we only assert both succeed).

### Success Criteria:

#### Automated Verification:

- New helper + test files exist under `src/test/generation/` and `src/lib/services/generation/`
- Tests pass: `npm test`
- Linting passes: `npm run lint`

#### Manual Verification:

- The mock seam reaches the real parse/validate/ground path (temporarily breaking the
  builder's citation makes the happy-path test fail for the *right* reason — grounding,
  not a mock artifact)

**Implementation Note**: After automated verification passes, pause for human
confirmation before Phase 2.

---

## Phase 2: Risk #2 — failure modes + retry semantics

### Overview

Prove every documented failure mode yields a typed `GenerationError` (never a silent
break), and the retry loop behaves: a transient first failure recovers, persistent
failure throws after exactly `MAX_ATTEMPTS`.

### Changes Required:

#### 1. Failure-mode cases

**File**: `src/lib/services/generation/generate.session.test.ts` (extend)

**Intent**: One case per branch in `generateSession`, asserting rejection with
`GenerationError` (by type) and a message identifying the mode. Covers the full
"never silently fails" contract.

**Contract**: Six cases —
(a) **empty-source pre-flight**: `generateSession("   ", intake)` rejects with
`GenerationError` (message contains "empty"); `create` never called.
(b) **API throw**: `create.mockRejectedValue(new Error(...))` → rejects (message
"API call failed").
(c) **empty content**: `create` resolves `makeCompletion(null)` / `""` → rejects
("empty response").
(d) **invalid JSON**: `create` resolves `makeCompletion("not json")` → rejects ("not
valid JSON").
(e) **schema-invalid**: `create` resolves a JSON object violating the schema — use the
`correctIndex >= options.length` refine (`schema.ts:38-41`) or a wrong MCQ count →
rejects ("schema validation").
(f) **ungrounded citation**: `create` resolves a valid-shaped session whose one
citation is absent from the source → rejects ("citation not found in source").
Each asserts `err instanceof GenerationError`.

#### 2. Retry semantics

**File**: `src/lib/services/generation/generate.session.test.ts` (extend)

**Intent**: Pin the `MAX_ATTEMPTS` loop — the subtle source of both silent-success and
silent-failure bugs.

**Contract**: **Recovery** — `create.mockResolvedValueOnce(<bad>).mockResolvedValueOnce(<valid>)`
→ `generateSession` resolves to a valid session; assert `create` called twice.
**Exhaustion** — `create` always resolves a bad response → rejects with
`GenerationError`; assert `create` called exactly twice (= `MAX_ATTEMPTS`).

### Success Criteria:

#### Automated Verification:

- All six failure-mode cases + recovery + exhaustion present and passing: `npm test`
- Linting passes: `npm run lint`

#### Manual Verification:

- Each failure case fails for its intended branch (spot-check one by altering its
  scripted response and confirming the expected message changes)

**Implementation Note**: Pause for human confirmation before Phase 3.

---

## Phase 3: Risk #1 structural grounding + cookbook & per-phase note

### Overview

Pin `findUngroundedCitation`'s actual contract — core pass/fail plus the normalization
and truncation tolerances — then fill the generation cookbook so future contributors
can reproduce the pattern.

### Changes Required:

#### 1. Structural grounding cases

**File**: `src/lib/services/generation/generate.session.test.ts` (extend)

**Intent**: Prove theory citations are structurally drawn from the source, including
the matcher's documented tolerances, without asserting model prose.

**Contract**: Cases —
(a) **grounded → success**: every citation a verbatim substring → resolves.
(b) **ungrounded → error**: one citation absent → rejects `GenerationError` ("citation
not found"). (Overlaps Phase 2(f); keep as the grounding-suite anchor or reference it.)
(c) **case-insensitive**: citation differs from source only in letter case → grounds
(success).
(d) **whitespace-normalized**: citation differs only in line breaks / multiple spaces →
grounds (success).
(e) **beyond-truncation**: `buildLargeSource` places the cited span after char 60,000;
the citation is absent from the validated slice → rejects (ungrounded). Documents that
grounding is checked against the truncated source (`generate.ts:100`).

#### 2. Cookbook + per-phase note

**File**: `context/foundation/test-plan.md`

**Intent**: Convert the §6 placeholders for the generation layer into the real "how to
add this test" entry, and record the phase's surprises. Do **not** touch the §3 status
cell (orchestrator owns that).

**Contract**: Fill **§6.2** (integration — generation service): location
(`src/lib/services/generation/generate.session.test.ts`), helper home
(`src/test/generation/`), the `vi.mock` openrouter pattern incl. the `importOriginal`
+ `vi.hoisted` gotcha, the sizing-aware completion builder, the run command
(`npm test`), and the **MSW-not-warranted** decision with its reason. Update **§6.1**
reference-unit pointer to mention the new file alongside `sizing.test.ts` /
`buildMessages`. Add a 2–3 line **§6.7** note (e.g., "the wired stub only resolves
imports; the real seam is `getOpenRouterClient`; `GenerationError` must survive the
mock").

### Success Criteria:

#### Automated Verification:

- Grounding cases incl. tolerance edges present and passing: `npm test`
- Full suite green: `npm test`
- Linting passes: `npm run lint`

#### Manual Verification:

- `test-plan.md` §6.1/§6.2/§6.7 read as actionable guidance — a contributor could add
  a new generation test from §6.2 alone
- Re-running `/10x-test-plan` recognizes Phase 1 as complete (plan fully checked off)

**Implementation Note**: After this phase, re-invoke `/10x-test-plan` to advance the
rollout (it marks §3 Phase 1 `complete` and presents Phase 2).

---

## Testing Strategy

### Unit / Integration Tests (this plan's deliverable):

- Happy path (with / without bio) → schema-valid session
- 6 failure modes → typed `GenerationError`
- Retry recovery (bad→good) and exhaustion (2× → throw)
- Structural grounding: grounded/ungrounded + case/whitespace/truncation tolerances

### Manual Testing Steps:

1. `npm test` — confirm the new suite is green and the case count matches the plan.
2. Sabotage one builder citation and confirm the happy-path test fails on grounding
   (proves the mock doesn't short-circuit the real path), then revert.
3. Read §6.2 and confirm it's sufficient to author a new generation test unaided.

## References

- Research: `context/changes/testing-generation-pipeline-contract/research.md`
- Strategy: `context/foundation/test-plan.md` §2 (Risks #1/#2), §3 Phase 1, §4, §6.1/§6.2
- Function under test: `src/lib/services/generation/generate.ts:91`
- Grounding check: `src/lib/services/generation/generate.ts:73-82`
- Sizing-derived schema: `src/lib/services/generation/schema.ts:54-60`, `sizing.ts:25-29`
- Client seam: `src/lib/services/generation/openrouter.ts:21-34`
- Reference tests: `src/lib/services/generation/generate.test.ts`, `sizing.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared test harness + happy-path contract

#### Automated

- [x] 1.1 New helper + test files exist under `src/test/generation/` and `src/lib/services/generation/` — 50008d8
- [x] 1.2 Tests pass: `npm test` — 50008d8
- [x] 1.3 Linting passes: `npm run lint` — 50008d8

#### Manual

- [x] 1.4 Mock seam reaches the real parse/validate/ground path (broken citation fails for the right reason) — 50008d8

### Phase 2: Risk #2 — failure modes + retry semantics

#### Automated

- [x] 2.1 All six failure-mode cases + recovery + exhaustion present and passing: `npm test` — 8a11563
- [x] 2.2 Linting passes: `npm run lint` — 8a11563

#### Manual

- [x] 2.3 Each failure case fails for its intended branch (spot-check) — 8a11563

### Phase 3: Risk #1 structural grounding + cookbook & per-phase note

#### Automated

- [x] 3.1 Grounding cases incl. tolerance edges present and passing: `npm test` — e6b6d6d
- [x] 3.2 Full suite green: `npm test` — e6b6d6d
- [x] 3.3 Linting passes: `npm run lint` — e6b6d6d

#### Manual

- [x] 3.4 `test-plan.md` §6.1/§6.2/§6.7 read as actionable guidance — e6b6d6d
- [x] 3.5 Re-running `/10x-test-plan` recognizes Phase 1 as complete — e6b6d6d
