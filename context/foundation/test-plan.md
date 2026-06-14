# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-13 (Phase 4 researched)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression. For MindTutor specifically: most risk lives in the
   generation service and the session API, both reachable by unit/integration
   with the OpenRouter edge stubbed — reserve the expensive AI-native judge
   (Phase 4) for the one risk no deterministic check covers cheaply.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data. Every top risk here
   traces to a Phase 2 interview answer or a PRD/roadmap line.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (excluding docs,
fixtures, archive, build output, and `node_modules`).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                        | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Grounding failure** — generated theory, exercises, or feedback contain claims not traceable to the uploaded file, and the learner trusts ungrounded content                                                  | High   | High       | interview Q1; PRD NFR ("no facts that cannot be traced to the source files"); roadmap S-01 named risk; hot-spot dir `src/lib/services/` (13 commits/30d)                                                        |
| 2   | **Generation pipeline silently fails** — a valid file plus complete intake still yields no session (OpenRouter error, malformed/partial JSON, schema-parse throw, exercise-shaping failure)                    | High   | High       | interview Q2 (lived incident) + Q3 (lowest-confidence area); PRD primary Success Criterion (~80% one-sitting completion) + reliability Guardrail; hot-spot dirs `src/pages/api/` (14), `src/lib/services/` (13) |
| 3   | **Cross-learner isolation / IDOR** — a learner reads or mutates another learner's session, materials, exercises, or score through the API by guessing IDs                                                      | High   | Medium     | interview Q4; PRD NFR (per-learner isolation) + Access Control (flat model, gated routes); F-01 RLS baseline; roadmap S-06 "deliberate cross-account read test"; hot-spot dir `src/pages/api/`                  |
| 4   | **Performance score miscomputed** — the score does not reflect percentage correct, or fails to aggregate across exercise types; the readiness signal is wrong                                                  | High   | Medium     | PRD FR-011 + Business Logic ("the score is the closing artifact") + Success Criterion (secondary: score calibration); hot-spot dir `src/lib/services/`                                                          |
| 5   | **Upload / parse error not surfaced** — an unsupported, corrupted, oversize, or empty-extraction file silently breaks or returns an opaque error instead of a clean explanatory message before generation runs | Medium | Medium     | PRD FR-004 + NFR (20 MB cap, reject before processing); infrastructure.md risk register (PDF parse cliff, now client-side); interview Q2 (adjacent)                                                             |

**Impact × Likelihood rubric.** High = user loses access/data or the wedge
breaks publicly / area changes weekly or we have already been burned here.
Medium = feature degrades with a workaround / touched occasionally, has been
a bug source. Low = cosmetic / stable code. Ordering protects High × High
(Risks #1, #2) first.

**Abuse / security lens.** Risk #3 is the explicit authorization/IDOR row —
it does not surface from the happy-path interview because the happy path
excludes the attacker. Untrusted-input / server-side zod validation parity
folds into Phase 2's API contract work. Secret/PII leakage (OpenRouter key
escaping into the client bundle) and resource abuse (mass session-creation /
costly generation in a loop) are watch-items recorded in §7, not top rows.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                             | Must challenge                                                               | Context `/10x-research` must ground                                                                                         | Likely cheapest layer                                                                                                 | Anti-pattern to avoid                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | Every factual claim in generated theory/exercise/feedback maps to a span in the source fixture; off-source claims are flagged                           | "Output looks plausible, therefore it is grounded"                           | Where the prompt injects source text; what the output schema carries; whether spans/citations exist to anchor claims        | Structural/contract checks (Phase 1) cheaply; an **AI-native LLM-judge** for the semantic remainder (Phase 4)         | Oracle problem — asserting expected values lifted from the model's own output, which green-lights current behaviour including hallucination |
| #2   | Given a valid source + intake, the service returns schema-valid output **or** a clean recoverable error the route/UI can surface — never a silent break | "A 200 from OpenRouter means success" (the JSON can still fail schema parse) | The OpenRouter client boundary; the JSON parse + zod schema path; how errors propagate from service to route to UI          | Integration on the generation service with the **OpenRouter edge stubbed** (stub already wired in `vitest.config.ts`) | Happy-path-only (the current test); over-mocking the schema parse so the real failure mode is never exercised                               |
| #3   | A non-owner receives 403/404 (not data) on every session-scoped read **and** mutation endpoint                                                          | "Logged-in implies authorized for this resource id"                          | Each session-scoped endpoint's ownership/RLS enforcement; the auth/session shape needed to drive a second identity in tests | Integration test hitting endpoints with a **second authenticated identity**                                           | Testing only that the owner CAN read; never asserting the non-owner is denied                                                               |
| #4   | Score equals an independently-computed percentage correct over a fixture of known answers, across MCQ and future exercise types                         | "A final number is present, therefore it is right"                           | Where the score is computed; how per-exercise correctness aggregates into the total                                         | Unit test on the scoring logic with a hand-built fixture                                                              | Expected value copied from the scoring code itself (oracle problem)                                                                         |
| #5   | A corrupt/oversize/unsupported/empty-extraction input yields a clean explanatory error before generation runs                                           | "Empty extracted text means no content, so proceed"                          | The upload validation path; client parse to empty/corrupt handling; the FR-004 error surface                                | Unit/integration on the validation + parse-error path                                                                 | Testing only the happy parse; asserting a silent pass-through of empty content into generation                                              |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                       | Goal (one line)                                                                                                                                                | Risks covered     | Test types                                             | Status      | Change folder                                               |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------ | ----------- | ----------------------------------------------------------- |
| 1   | Generation pipeline contract & failure modes     | Prove valid input never silently fails, malformed LLM JSON yields a clean recoverable error, and output is schema-valid and structurally drawn from the source | #2, structural #1 | unit + integration (OpenRouter stubbed)                | complete    | context/changes/testing-generation-pipeline-contract/       |
| 2   | Cross-learner isolation across the session API   | Prove a non-owner is denied (403/404) on every session-scoped read and mutation endpoint                                                                       | #3                | integration (second identity) + server-side validation | complete    | context/archive/2026-06-10-testing-cross-learner-isolation/ |
| 3   | Score correctness + upload/parse error surfacing | Prove score equals independently-computed percent correct, and bad input yields a clean explanatory error rather than a silent break                           | #4, #5            | unit + integration                                     | complete    | context/changes/testing-score-and-upload-errors/            |
| 4   | Grounding fidelity (the wedge)                   | Detect off-source claims in generated content that the Phase 1 structural checks cannot catch                                                                  | semantic #1       | AI-native LLM-judge                                    | implementing | context/changes/testing-grounding-judge/                  |

**Status vocabulary** (fixed — parser literals): `not started` →
`change opened` → `researched` → `planned` → `implementing` → `complete`.

Order rationale: Phase 1 attacks the two High × High risks at the cheapest
layer and extends the only existing test cluster (highest churn + the lived
incident). Phase 2 is the security floor and bootstraps API-route testing
(currently zero). Phase 3 is deterministic correctness, cheap once the
harness exists. Phase 4 is the most expensive and least deterministic layer,
depends on the Phase 1 harness, and covers only the semantic grounding
remainder — last by cost × signal.

## 4. Stack

The classic test base for this project. AI-native tools carry a `checked:`
date so future readers can see which lines need re-verification.

| Layer                   | Tool                                      | Version | Notes                                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration      | Vitest                                    | ^4.1.8  | `node` env, `@/*` alias, `astro:env/server` stubbed; `npm test` = `vitest run`. Only 2 tests today, both in `src/lib/services/generation/` — test base is **sparse**                                                                    |
| API mocking             | (network-edge stub)                       | n/a     | OpenRouter is stubbed via the `astro:env/server` alias in `vitest.config.ts`; no MSW yet — Phase 1 decides whether MSW is warranted for the session API                                                                                 |
| API / route integration | Vitest (DB-backed) — checked: 2026-06-10  | ^4.1.8  | Phase 2 bootstrapped this: `npm run test:integration` (separate `vitest.integration.config.ts`) runs `*.integration.test.ts` against **local Supabase**; harness in `src/test/integration/`. Local-only for now (CI gate deferred — §5) |
| e2e                     | none yet — not currently scoped           | —       | No Playwright/Cypress installed; no e2e phase in this rollout (cost × signal — service + route integration covers the top risks)                                                                                                        |
| accessibility           | `eslint-plugin-jsx-a11y` (lint-time only) | 6.10.2  | Static a11y lint exists; no runtime a11y testing scoped                                                                                                                                                                                 |
| (optional) AI-native    | LLM-judge — checked: 2026-06-09           | n/a     | Grounding fidelity (Phase 4). **When NOT to use:** when a deterministic structural check (claim maps to a source span) already catches the regression — do not layer a judge on top of a check that already fails for the right reason  |

**Stack grounding tools (current session):**

- Docs: Cloudflare docs MCP available; **Context7 — not available in current session**; checked: 2026-06-09
- Search: **Exa.ai / web-search MCP — not available in current session**; checked: 2026-06-09
- Runtime/browser: **Playwright / browser MCP — not available in current session**; not used this rollout; checked: 2026-06-09
- Provider/platform: Supabase MCP and Cloudflare-bindings MCP available, `gh` CLI present — relevant to Phase 5-style CI gates and to verifying RLS for Phase 2; checked: 2026-06-09

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                       | Where                          | Required?                 | Catches                                                   |
| -------------------------- | ------------------------------ | ------------------------- | --------------------------------------------------------- |
| lint + typecheck           | local (husky/lint-staged) + CI | required                  | syntactic / type drift; `eslint` + `astro check`          |
| unit + integration         | local + CI                     | required after §3 Phase 1 | generation-pipeline logic regressions and silent failures |
| API isolation integration  | CI on PR                       | required after §3 Phase 2 | cross-learner IDOR / RLS regressions                      |
| score + upload-error tests | local + CI                     | required after §3 Phase 3 | miscomputed score; unhandled bad-input paths              |
| AI-native grounding judge  | CI on PR (or pre-merge)        | optional after §3 Phase 4 | off-source claims classic checks miss                     |

CI today (`.github/workflows/ci.yml`) runs lint + the unit suite
(`npm run test`) + build. The DB-backed integration suite
(`npm run test:integration`) and the AI-native grounding judge are **not** yet
wired into CI — that wiring is owned by the named rollout phases above plus the
Module-1/Module-2 CI lessons. This guide names the gates, it does not write the
YAML.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, it reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Location & naming:** co-locate as `*.test.ts` beside the module under test;
  `vitest.config.ts` includes `src/**/*.test.ts`. Run with `npm test` (=`vitest run`)
  or `npm run test:watch`.
- **Reference units (pure logic):** `src/lib/services/generation/sizing.test.ts`
  (intake → sizing map) and `src/lib/services/generation/generate.test.ts`
  (`buildMessages` prompt construction). These need no mocks — keep pure logic pure.
- For a service that calls an external edge (LLM/DB), see §6.2 — mock the seam, do
  not test the edge. Score/aggregation units land in Phase 3 (see §3).

### 6.2 Adding an integration test (generation service)

Pattern landed in Phase 1. Reference:
`src/lib/services/generation/generate.session.test.ts`, with shared helpers in
`src/test/generation/` (`openrouter-mock.ts`, `completion-builder.ts`).

- **Mock the seam, not the edge.** The `astro:env/server` alias in
  `vitest.config.ts` only _resolves_ the import graph (dummy env values) — it does
  **not** intercept the network call. Drive the service by mocking the single client
  seam `getOpenRouterClient`. **Decision: `vi.mock`, not MSW** — one function seam, no
  real HTTP, so MSW (the §4 open question) is not warranted for the generation service.
- **Keep the real errors.** The mock factory must spread `importOriginal()` so the real
  `GenerationError` (tests assert `instanceof`) and `getModel` survive; override only
  `getOpenRouterClient`. The `create` spy must be created with `vi.hoisted` because
  `vi.mock` is hoisted above imports:

  ```ts
  const { create } = vi.hoisted(() => ({ create: vi.fn() }));
  vi.mock("@/lib/services/generation/openrouter", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/services/generation/openrouter")>()),
    getOpenRouterClient: () => fakeOpenRouterClient(create),
  }));
  ```

- **Build off one valid baseline.** `buildValidSession(intake, overrides?)` returns a
  schema-valid, source-grounded session for the intake's sizing; each failure/grounding
  case is a one-line `overrides` delta (bad `correctIndex`, ungrounded citation, etc.).
  Script responses with `create.mockResolvedValue(makeCompletion(json))`; use
  `mockResolvedValueOnce(...).mockResolvedValueOnce(...)` to exercise the retry loop.
- **Assert structure + grounding, never model wording** (oracle problem; §2 Risk #1/#2,
  §7). Failure-mode cases assert `instanceof GenerationError` + a branch-specific message
  substring. Run with `npm test`.

### 6.3 Adding a test for a new API endpoint

Pattern landed in Phase 2. DB-backed integration against **local Supabase** — RLS,
not TypeScript, enforces per-learner ownership, so a mocked client tests nothing. Run
with `npm run test:integration` after `npx supabase start` (keys auto-load from
`supabase status`; the default `npm test` stays Supabase-free). Specs use the
`*.integration.test.ts` suffix (`vitest.integration.config.ts`).

- **Two real identities.** `src/test/integration/setup.ts` `getIdentities()` seeds two
  learners via the admin API (idempotent, fixed users) and returns `clientA`/`clientB`
  (anon-key clients carrying real JWTs) + their ids. `createSessionGraph(client, userId)`
  (`factories.ts`) creates an owned session graph so the other identity has a victim row.
- **RLS layer first (load-bearing).** Reference:
  `src/test/integration/rls-isolation.integration.test.ts`. For each table assert the
  non-owner read/update/delete affects **0 rows** and the owner-can control returns the
  row (so the denial is not vacuous). Blocked UPDATE/DELETE return 0 rows with **no
  error**; a forged-`user_id` INSERT **raises** (`with check`) — assert each accordingly.
- **Handler slice (404 translation).** References:
  `src/pages/api/sessions/[id]/complete.integration.test.ts` and
  `.../exercises/[exerciseId].integration.test.ts`. `vi.mock("@/lib/supabase")`'s
  `createClient` to return a **real** client authed as B (RLS stays live — only client
  construction is mocked; this is NOT the "mock the Supabase client" anti-pattern), then
  invoke the `APIRoute` `POST` with a faked `context` (`locals.user` = B, `params` = A's
  ids). Assert **404 + no leaked row data** (never 403), and add an owner-200 control.
- **The load-bearing assertion is non-owner-denied** — never only "owner CAN read".

### 6.4 Adding a score / aggregation test

Pattern landed in Phase 3. Reference: `src/lib/services/scoring.test.ts` — a pure unit
beside the module (§6.1 style, no mocks). Run with `npm test`.

- **Independent oracle, never a lifted value.** Compute each expected percentage by hand
  from the fixture rows (`score = round(correct/total*100)`, empty set → 0); do NOT copy
  expected values out of `computeScore` (the §2 Risk #4 oracle anti-pattern).
- **Pin the whole contract, not just the happy case.** Cover empty→0, all-correct→100, a
  rounding pair (1/3→33, 2/3→67), the `.5` boundary (1/8→13 — `Math.round` rounds toward
  +∞), unanswered-`null`-counts-as-incorrect (2 of 5 → 40), and a **mixed-kind** fixture
  proving aggregation never inspects `kind`.
- **Fixture shape:** `Pick<Exercise, "is_correct" | "kind">[]`. `computeScore` reads only
  `is_correct`, so a future exercise kind aggregates for free once its own endpoint
  populates `is_correct` (correctness _determination_ is per-kind; _aggregation_ is not).

### 6.5 Adding an upload / parse error-path test

Pattern landed in Phase 3. Two layers, both under default `npm test` (node env, no DB, no
network):

- **Client type/size gate (pure unit).** Reference:
  `src/components/session/lib/parseFile.test.ts`. `validateFile`/`extensionOf` are pure and
  import-safe (pdf.js is lazily imported inside `parsePdf` only, per `lessons.md`), so no
  mocks/jsdom. Override `File.size` via `Object.defineProperty` to hit the oversize branch
  without allocating 20 MB. Cover unsupported type, oversize, each allowed type, the size
  boundary (the guard is `> MAX`, so `=== MAX` must pass), and extension edges (no dot,
  uppercase, leading-dot dotfile, multi-dot).
- **Server guard (route-level test).** Reference: `src/pages/api/sessions/index.test.ts`.
  `vi.mock("@/lib/supabase")` so `createClient` returns a dummy **non-null** (clears the
  `if (!supabase)` 500 guard); `vi.mock` the generation module so `generateSession` is a
  `vi.hoisted` spy. Fake the `APIContext` with a `request.formData()` that returns a
  `FormData` **directly** (no multipart round-trip — an overridden `File.size` survives).
  Invoke `POST` and assert, for each of the four bad inputs: `400` + the exact message
  **AND** `expect(generateSession).not.toHaveBeenCalled()` — this pins the "before
  generation runs" ordering invariant. The empty-`extractedText` case is the §2
  must-challenge ("empty means no content, so proceed").
- **Guard ordering.** The four guards run in sequence (file → text → extension → size), so
  each fixture must be otherwise-valid up to the guard under test.
- **Drift guard.** `MAX_SIZE_BYTES`/`ALLOWED_EXTENSIONS` are duplicated in `parseFile.ts`
  and `sessions/index.ts` (not shared); assert the same `.docx` / 21 MB inputs at both
  layers so the two copies cannot drift apart silently.

### 6.6 Adding an AI-native grounding check

Pattern landed in Phase 4. The judge lives in `src/lib/services/grounding/`
(`schema.ts` = zod verdict contract, `judge.ts` = the judge) and is split into a
**deterministic core** (runs in `npm test`) and an **opt-in live suite**
(`npm run test:livejudge`).

- **Only the semantic remainder — never re-check a deterministic gate.** The judge
  grades prose `findUngroundedCitation` can't see: `theory[].body`/`heading`, MCQ
  `prompt`, the **correct** option, `feedback`, `title`. It must NOT re-assert that
  `theory[].citation` occurs in the source — that is Phase 1's structural check, and
  re-checking it is the §4 "When NOT to use the judge" anti-pattern.
- **Exempt distractors — they are intentionally off-source.** `buildGroundingClaims`
  submits only `options[correctIndex]` (the McqSchema refine guarantees it is in range);
  the other options are plausible-but-wrong by design and must never be sent for
  grounding, or the judge false-flags every one. The `distractorControl` fixture proves
  the exemption holds end-to-end.
- **Ground against the 60k slice the generator saw.** `judgeGrounding` truncates the
  source to `MAX_SOURCE_CHARS` before the call, so a claim grounded only beyond the cap
  is correctly flagged (the `truncation` fixture pins this; mirrors `generate.session.test.ts`).
- **The fixture label is the oracle — never the model's own verdict.** `src/test/grounding/fixtures.ts`
  hand-authors a source + sessions with author-assigned PASS/FLAG labels (faithful
  paraphrase → PASS; planted contradiction → FLAG; truncated-away → FLAG; distractor
  control → PASS). Asserting the judge's output against the model's own output would
  green-light current hallucination (the §2 Risk #1 oracle anti-pattern).
- **Live, keyed, opt-in.** The judge makes ONE real OpenRouter call (temperature 0 +
  `json_object` for reproducibility) through the existing `getOpenRouterClient` seam —
  via OpenRouter, not the Anthropic SDK. The `*.livejudge.test.ts` suffix is excluded
  from `npm test` (`vitest.config.ts`); the suite runs via `npm run test:livejudge`
  (`vitest.livejudge.config.ts`), which auto-loads `OPENROUTER_API_KEY` from
  `.dev.vars`/`.env` and **fails fast** (never silently passes) when it is absent.
- **Wiring is deterministic — don't pay a model to test it.** `judge.test.ts` stubs the
  seam (reusing `src/test/generation/openrouter-mock.ts`) and asserts the distractor
  exemption, verdict parse/aggregation, and malformed-response throws — all in `npm test`.
- **Optional CI gate (not wired here).** Per §5 this gate is `CI on PR (or pre-merge)`,
  `optional after Phase 4`. Wiring it needs an `OPENROUTER_API_KEY` repo secret + a
  conditional `npm run test:livejudge` step; this lesson names the gate but does not
  author the YAML.

### 6.7 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the rollout phase taught.)

- **Phase 1 (generation contract & failure modes):** the "wired stub" only resolves
  the import graph — the real seam to control is `getOpenRouterClient`, and
  `GenerationError`/`getModel` must survive the `vi.mock` via `importOriginal`.
  Grounding (`findUngroundedCitation`) is validated against the **60k-truncated** slice
  and checks `theory[].citation` only — `body`/`feedback` prose is the Phase 4 judge's
  job. Full contract (happy path, 6 failure modes, retry recovery/exhaustion, grounding
  - case/whitespace/truncation tolerances) lives in `generate.session.test.ts`.
- **Phase 2 (cross-learner isolation):** ownership is enforced **only** by Supabase RLS
  (no handler re-checks `user_id`), so the suite must hit real Postgres — a mocked client
  passes while testing nothing. Denial surfaces as **404** via `.single()`-on-empty (not
  403). Asymmetry: an RLS-blocked UPDATE/DELETE returns **0 rows, no error**, while a
  forged INSERT **raises** (`with check`). Suite is **local-only first** (no CI YAML this
  rollout); local Supabase keys auto-load from `supabase status`. Gotcha: a Windows
  Docker-socket issue can wedge the `vector`/Kong pipeline — `supabase stop && start` clears it.
- **Phase 3 (score correctness + upload/parse errors):** the score is one pure function
  (`computeScore`, single call site), so its cheapest real signal is a unit with a
  **hand-computed** oracle — the §2 anti-pattern is lifting expected values from the code.
  The DB-backed wiring integration was deliberately skipped (cost×signal — Phase 2's
  owner-200 control already touches answer→aggregate→persist). Risk #5's load-bearing
  surface is the **server** re-validation: four guards return `400` **before** generation,
  pinned by a `generateSession` spy-not-called assertion (the ordering invariant).
  `MAX_SIZE_BYTES`/`ALLOWED_EXTENSIONS` are duplicated client/server → asserted at both
  layers to catch drift. The React form's own empty/corrupt surfacing is NOT tested (no
  jsdom/RTL — see §7).
- **Phase 4 (grounding fidelity LLM-judge):** the judge covers the **complement of one
  substring check** — the prose `findUngroundedCitation` (citation-only) can't reach; it
  must never re-grade `theory[].citation` (§4 boundary). The load-bearing subtlety is the
  **distractor exemption**: only `options[correctIndex]` is submitted, never the
  intentionally-off-source distractors. Split into a **deterministic wiring unit** (stubbed
  seam, in `npm test`) and an **opt-in live suite** (`npm run test:livejudge`, real keyed
  call, excluded from `npm test`); fixtures are hand-labeled (the oracle is ours, not the
  model's output). **Watch-item:** the judge reuses `OPENROUTER_MODEL` (the generator's own
  gpt-4o-mini) — fine for the test (labels are ours) but it could share a blind spot with
  the generator on *real* output; `JUDGE` model selection is a one-line change for a future
  cross-family phase. The optional CI gate (§5) is documented but not wired (CLAUDE.md: no
  CI/CD authoring this lesson).

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Marketing / static pages** — no business logic; trivial to eyeball.
  Re-evaluate if a static page gains interactive or auth-gated behaviour.
  (Source: Phase 2 interview Q5.)
- **shadcn/ui primitives in `src/components/ui/`** — vendored, "new-york"
  variant; the upstream library is the test. Re-evaluate only if we fork or
  heavily customise a primitive. (Source: Phase 2 interview Q5.)
- **Exact LLM output wording** — non-deterministic; asserting verbatim text
  is brittle and catches nothing. Test structure, schema-validity, and
  grounding instead (see Risks #1, #2). (Watch-item, not from Q5.)
- **New-Session form's client-side empty/corrupt surfacing** — the React form's own
  empty-extraction guard and corrupt-file catch (`NewSessionForm.tsx`) are not unit-tested:
  there is no jsdom/RTL in the stack (§4), and the trust boundary is the server, which is
  covered (§6.5 server guard). Re-evaluate if jsdom/RTL is added or the form's error
  branching grows. (Source: Phase 3 plan decision.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-13 (§5 CI line corrected)
- Stack versions last verified: 2026-06-13
- AI-native tool references last verified: 2026-06-13

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
