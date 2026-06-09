---
date: 2026-06-09T00:00:00Z
researcher: porebkon
git_commit: 819286dd161d65b9841b56cd39627b9b1e3596a1
branch: master
repository: MindTutor
topic: "Phase 1 — Generation pipeline contract & failure modes (Risk #2, structural Risk #1)"
tags: [research, codebase, generation, testing, openrouter-stub, grounding]
status: complete
last_updated: 2026-06-09
last_updated_by: porebkon
---

# Research: Generation pipeline contract & failure modes (test-plan Phase 1)

**Date**: 2026-06-09
**Researcher**: porebkon
**Git Commit**: 819286dd161d65b9841b56cd39627b9b1e3596a1
**Branch**: master
**Repository**: MindTutor

## Research Question

Ground test-plan Phase 1 in current code. Two risks:
- **Risk #2** — given a valid source + complete intake, the generation service must
  return schema-valid output **or** a clean recoverable error the route/UI can
  surface — never a silent break.
- **Risk #1 (structural only)** — generated theory must be structurally drawn from
  the provided source (citations map to verbatim source spans). The semantic
  "no off-source claims" judge is deferred to Phase 4.

Specifically: where does the prompt inject source text; what does the output schema
carry; where is the OpenRouter client boundary; what is the JSON-parse + zod path;
how do errors propagate service → route → UI; and what does "stub already wired in
`vitest.config.ts`" actually give us.

## Summary

The generation contract lives in **one function**, `generateSession()` in
`src/lib/services/generation/generate.ts:91`. It is the right unit for Phase 1: it
owns the full parse → validate → ground → retry → throw chain, and it reaches
OpenRouter through a **single seam** (`getOpenRouterClient()` in
`openrouter.ts:21`) that a test can mock cleanly.

The function already implements exactly the contract Risk #2 demands: every failure
mode is funneled into a single typed `GenerationError`, and a transient first-attempt
failure is retried once before throwing. There are **five distinct failure modes**
plus a pre-flight empty-source guard — each must be exercised so we prove none of
them silently returns a malformed/partial session.

For structural Risk #1, grounding is enforced by `findUngroundedCitation()`
(`generate.ts:73`): a whitespace-normalized, lowercased **substring** check that
every theory step's `citation` occurs verbatim in the (truncated) source. This is
the structural "claims map to source spans" check — but note its **scope**: it
validates the `theory[].citation` field only, not `body`/`heading` and not exercise
prompts/feedback. That gap is precisely the semantic remainder Phase 4 owns.

**Critical nuance about the "stub already wired":** `vitest.config.ts:13` aliases
the `astro:env/server` virtual module to a stub that only exports dummy
`OPENROUTER_API_KEY="test-key"` / `OPENROUTER_MODEL="test-model"`
(`src/test/stubs/astro-env-server.ts`). That makes the import graph **resolve** and
`getOpenRouterClient()` **succeed** — but it does **not** intercept the network call.
The two existing tests never call `generateSession`; they exercise only the pure
`buildMessages` and `sizeFromIntake`. **Phase 1 must add a new mock layer** that
controls `client.chat.completions.create`'s return value to drive each failure mode.
The cheapest seam is `vi.mock` of the `openrouter` module (or of `getOpenRouterClient`)
returning a fake client — **MSW is not warranted** for a service-layer contract reached
through one function seam (this answers the open question test-plan §4 left to Phase 1).

## Detailed Findings

### The generation service — the unit under test

`generateSession(sourceText, intake, bio?): Promise<GeneratedSession>`
(`src/lib/services/generation/generate.ts:91`)

Control flow, in order:

1. **Pre-flight empty-source guard** (`generate.ts:96-99`): `sourceText.trim()` empty
   → throws `GenerationError("Source material is empty; nothing to generate from")`
   **before any API call**. (Failure mode #0.)
2. Truncate source to `MAX_SOURCE_CHARS = 60_000` (`generate.ts:17,100`). Citations
   are validated against **exactly the truncated slice** sent to the model — a
   relevant edge if a fixture's cited span sits past 60k chars.
3. Compute sizing **once** via `sizeFromIntake(intake)` and derive the validation
   schema from it: `makeGeneratedSessionSchema(sizing)` (`generate.ts:105-106`).
   This is deliberate (`generate.ts:102-104`): prompt bounds and schema bounds come
   from the same sizing object so a retry can't validate against bounds the prompt
   never asked for. **Test consequence:** a "valid" stubbed completion must match the
   chosen intake's sizing or it fails schema validation. For `timeBudgetMinutes: 30`
   → theory 3–4 items, exactly 5 MCQs (see sizing table below).
4. Build messages once (`buildMessages`, already tested) and enter the retry loop
   `MAX_ATTEMPTS = 2` (`generate.ts:18,114`).

Per attempt, in order — each non-success sets `lastReason` and `continue`s:

| # | Failure mode | Guard / line | `lastReason` text |
|---|--------------|--------------|-------------------|
| 1 | OpenRouter call throws (network/API error) | try/catch `generate.ts:116-128` | `API call failed: <msg>` |
| 2 | Empty / null content | `generate.ts:130-133` | `model returned an empty response` |
| 3 | Response not valid JSON | `JSON.parse` catch `generate.ts:135-141` | `model response was not valid JSON` |
| 4 | JSON fails zod schema | `safeParse` `generate.ts:143-147` | `response failed schema validation: <issue>` |
| 5 | Citation not in source (ungrounded) | `findUngroundedCitation` `generate.ts:149-153` | `citation not found in source: "…"` |
|  | **success** | `generate.ts:155` | returns `result.data` |

After the loop exhausts both attempts → throws
`GenerationError("Generation failed after 2 attempts: " + lastReason)` (`generate.ts:158`).

**Retry semantics worth a dedicated test:** a bad first attempt followed by a good
second attempt **recovers** and returns successfully (drive with
`create.mockResolvedValueOnce(bad).mockResolvedValueOnce(good)`). Conversely, two
persistent failures throw. Both are part of the "never silently fails" contract.

### Structural grounding — the Risk #1 (structural) check

`findUngroundedCitation(session, sourceText)` (`generate.ts:73-82`):

- `normalizeWhitespace` collapses all whitespace runs to a single space and trims
  (`generate.ts:22-24`), then both source and citation are lowercased.
- For each `theory[].citation`, asserts `haystack.includes(needle)`; returns the
  first offending citation or `null`.
- **Scope (the Phase 1 / Phase 4 boundary):** checks `theory[].citation` **only**.
  It does **not** check `theory[].body`, `theory[].heading`, or any exercise field.
  So structural Phase 1 proves "every theory step carries a verbatim source span";
  whether the `body`/`feedback` prose stays on-source is the semantic judge's job
  (Phase 4). State this boundary explicitly in the plan so the structural test isn't
  over-claimed.
- **Matching tolerances to exercise in tests:** case-insensitive match (citation in
  different case still grounds); whitespace/line-break differences still ground;
  a citation absent from the source (or present only beyond the 60k truncation)
  is flagged.

### Output schema — what "schema-valid" means

`src/lib/services/generation/schema.ts`:

- `TheoryStepSchema` (`schema.ts:22-27`): `position` int ≥0, `heading` min 1,
  `body` min 1, `citation` min 1.
- `McqSchema` (`schema.ts:30-41`): `position` int ≥0, `prompt` min 1, `options`
  array of non-empty strings length **3–5**, `correctIndex` int ≥0, `feedback`
  min 1, plus a `.refine` that **`correctIndex < options.length`** (path
  `correctIndex`). This refine is a good schema-violation fixture (in-range count,
  out-of-range index).
- `makeGeneratedSessionSchema(sizing)` (`schema.ts:54-60`): `theory` array
  `.min(sizing.theoryMin).max(sizing.theoryMax)`, `exercises` `.length(sizing.mcqCount)`.
  The fixed `GeneratedSessionSchema` (`schema.ts:43-47`, theory 3–5, exactly 5 MCQs)
  is the no-intake fallback — **not** the path `generateSession` uses; the dynamic
  one is. Build fixtures against the dynamic bounds for the chosen intake.

### Sizing — what a valid completion must match

`src/lib/services/generation/sizing.ts:25-29` (`COUNTS_BY_BUDGET`):

| timeBudgetMinutes | theoryMin | theoryMax | mcqCount |
|-------------------|-----------|-----------|----------|
| 15 | 2 | 3 | 3 |
| 30 | 3 | 4 | 5 |
| 60 | 4 | 6 | 8 |

`knowledgeLevel` only changes `depthGuidance` text, not counts. A fixture for the
"happy path" should pick one budget and emit theory/MCQ counts inside those bounds.

### OpenRouter client boundary — the mock seam

`src/lib/services/generation/openrouter.ts`:

- `getOpenRouterClient()` (`openrouter.ts:21-29`) throws
  `GenerationError("OPENROUTER_API_KEY is not configured")` when the key is unset,
  else returns an `OpenAI` client pointed at `https://openrouter.ai/api/v1`.
- `getModel()` returns `OPENROUTER_MODEL` (`openrouter.ts:32-34`).
- `GenerationError` is defined here (`openrouter.ts:12-17`) and re-exported through
  the route import (`api/sessions/index.ts:14`).
- **Consumed shape** in `generate.ts:117-124`:
  `client.chat.completions.create({...})` → `completion.choices[0]?.message?.content`.
  A fake client therefore only needs
  `{ chat: { completions: { create: vi.fn() } } }` returning
  `{ choices: [{ message: { content: "<json string|empty|null>" } }] }`.
- openai SDK version: `^6.42.0` (`package.json:35`); zod `^4.4.3`; vitest `^4.1.8`.

**Same seam, other consumer:** `src/lib/services/onboarding/distill.ts` also calls
`getOpenRouterClient()`. Out of Phase 1 scope, but if Phase 1 lands a reusable
OpenRouter-mock + completion-builder helper, distill tests inherit it for free —
worth placing the helper somewhere shareable (e.g. `src/test/`).

### Error propagation — service → route → UI

Route `POST /api/sessions` (`src/pages/api/sessions/index.ts`):

- Generation runs **before any DB write** (`index.ts:7-8,93-103`), so a generation
  failure leaves nothing half-created — the learner retries cleanly.
- `catch (err)` (`index.ts:97-103`): `if (err instanceof GenerationError)` →
  `console.error(...)` + `return json({ error: "Could not generate a session from
  this material. Please try again." }, 502)`. **Else `throw err`** — a
  non-`GenerationError` propagates uncaught to the framework → opaque 500.
  Today `generate.ts` wraps *every* failure as `GenerationError`, so in practice
  only `GenerationError` escapes; the route's clean-502 contract **depends on that
  invariant**. A worthwhile assertion: the service throws `GenerationError`
  (not a bare `Error`) for all five modes, so the route's 502 path always fires.
- UI surface `src/components/session/NewSessionForm.tsx:68-81`: on `!res.ok` it reads
  `data.error` and shows it (`setError(data?.error ?? "Something went wrong…")`), and
  its own `catch` shows a corrupt-file message. So the 502 body's `error` string is
  what the learner sees — confirming "a clean recoverable error the route/UI can
  surface."

**Scope call for the plan:** Phase 1's cheapest, highest-signal target is
`generateSession` itself (assert schema-valid return on happy path; assert
`GenerationError` with the right `lastReason` for each of the 6 modes; assert retry
recovery). A route-level test (assert `GenerationError` → 502 + clean body) needs an
Astro `APIRoute` harness + mocked supabase + `locals.user` — that infra is what
**Phase 2 bootstraps** (test-plan §3, §4: "Session API routes have zero tests").
Recommend Phase 1 stay at the service layer and leave the 502-mapping assertion to
Phase 2's route harness (or include one thin route test only if the plan accepts the
harness cost now). `/10x-plan` decides under cost × signal.

### Test harness & conventions (current state)

- `vitest.config.ts`: `environment: "node"`, `include: ["src/**/*.test.ts"]`,
  `@/*` alias, `astro:env/server` → stub (`vitest.config.ts:7-20`).
- Existing tests co-locate as `*.test.ts` beside source in
  `src/lib/services/generation/` (`sizing.test.ts`, `generate.test.ts`). `npm test`
  = `vitest run`; `npm run test:watch` = `vitest`.
- `generate.test.ts` already covers `buildMessages` (prompt injection, bio,
  determinism) — **Phase 1 must not re-test prompt wording**; it targets
  `generateSession`'s runtime contract + grounding. New file likely
  `src/lib/services/generation/generate.session.test.ts` (or similar); name is a
  plan decision.
- **No fixtures directory exists yet** (`src/test/` holds only `stubs/`). Phase 1
  introduces: a source-text fixture with known spans; a valid-completion builder
  (schema-valid JSON whose theory citations are verbatim substrings of the source and
  whose counts match the chosen intake's sizing); and mutators for each failure mode
  (invalid-JSON string, schema-violating object, ungrounded-citation object,
  empty/null content, throwing client). These are §6.2 cookbook material.

## Code References

- `src/lib/services/generation/generate.ts:91` — `generateSession`, the Phase 1 unit
- `src/lib/services/generation/generate.ts:96-99` — empty-source pre-flight guard (mode #0)
- `src/lib/services/generation/generate.ts:114-156` — retry loop with the 5 failure modes
- `src/lib/services/generation/generate.ts:73-82` — `findUngroundedCitation` (structural Risk #1)
- `src/lib/services/generation/generate.ts:100` — 60k source truncation (citation-match edge)
- `src/lib/services/generation/schema.ts:30-41` — `McqSchema` + `correctIndex` refine
- `src/lib/services/generation/schema.ts:54-60` — `makeGeneratedSessionSchema` (dynamic bounds)
- `src/lib/services/generation/sizing.ts:25-29` — `COUNTS_BY_BUDGET` (fixture counts)
- `src/lib/services/generation/openrouter.ts:21-34` — client seam + `getModel`
- `src/lib/services/generation/openrouter.ts:12-17` — `GenerationError`
- `src/pages/api/sessions/index.ts:97-103` — service→route error mapping (502 vs re-throw 500)
- `src/components/session/NewSessionForm.tsx:68-81` — UI error surface
- `src/test/stubs/astro-env-server.ts` — env stub (resolves imports; does NOT mock network)
- `vitest.config.ts:7-20` — harness + alias config
- `src/lib/services/onboarding/distill.ts` — second `getOpenRouterClient` consumer (shareable-helper note)

## Architecture Insights

- **Single typed failure channel.** Every failure converges on `GenerationError`,
  which is the testable contract: "valid input → schema-valid session OR a
  `GenerationError` the route maps to a clean 502," never an untyped throw or a
  partial object. The route's 502 path is only safe while that invariant holds, so
  asserting the error *type* per mode is as important as asserting the message.
- **Prompt and schema derive from one sizing object**, so validation can never drift
  from what the prompt requested across retries. Fixtures must respect this coupling.
- **Grounding is a cheap deterministic substring check, by design** — it catches the
  *structural* class of hallucination (fabricated citations) without a model. Phase 4
  layers the semantic judge only on the remainder (off-source `body`/`feedback`
  prose), honoring §4's "When NOT to use" rule.
- **The "stub" is an import-resolution stub, not a network mock.** This is the single
  most load-bearing finding for the plan: Phase 1's real work is introducing the
  completion-control seam (`vi.mock` of `openrouter`), which the existing tests never
  needed.

## Historical Context (from prior changes)

- This change folder (`context/changes/testing-generation-pipeline-contract/change.md`)
  was opened as rollout Phase 1 of `context/foundation/test-plan.md` §3.
- The generation service originates from slice **S-01** (grounded generation),
  intake-driven sizing from **S-02**, and the optional bio tailoring from **S-03**
  (see header comments in `generate.ts`, `sizing.ts`, `schema.ts`). The most recent
  archived slice was `onboarding-bio-tailoring` (S-03), which added the `bio`
  parameter the happy-path fixture may exercise (with/without bio) but whose prompt
  effects are already covered by `generate.test.ts`.

## Related Research

- `context/foundation/test-plan.md` §2 (Risk Map), §2 Risk Response Guidance rows #1/#2,
  §3 Phase 1 row, §4 (stack — MSW open question), §6.1/§6.2 (cookbook slots to fill).

## Open Questions

1. **MSW vs `vi.mock`** — research recommends `vi.mock` of the `openrouter` seam
   (single function, no real HTTP); test-plan §4 explicitly defers this decision to
   Phase 1. Plan should record the decision and the reason in §6.2.
2. **Route-layer coverage now or in Phase 2?** The 502-mapping assertion needs an
   Astro APIRoute + supabase-mock harness that Phase 2 bootstraps. Recommend deferring
   unless the plan accepts that harness cost in Phase 1.
3. **Helper placement** — put the OpenRouter-mock + completion-builder where
   `distill.ts` tests can reuse it later (e.g. `src/test/`), vs co-located in
   `generation/`. Plan decision.
4. **Fixture-naming / file-naming** for the new `generateSession` integration test
   and the source fixture — plan decision (feeds §6.1/§6.2 cookbook entries).
