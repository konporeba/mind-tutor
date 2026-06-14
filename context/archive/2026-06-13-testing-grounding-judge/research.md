---
date: 2026-06-13T20:24:00Z
researcher: porebkon
git_commit: f71b7e433fdb3dd62ce71f4e74767fa4bc76437e
branch: master
repository: MindTutor
topic: "Phase 4 — Grounding fidelity LLM-judge (semantic remainder of Risk #1)"
tags: [research, codebase, grounding, llm-judge, testing, ai-native, oracle-problem]
status: complete
last_updated: 2026-06-13
last_updated_by: porebkon
---

# Research: Grounding fidelity LLM-judge (test-plan Phase 4)

**Date**: 2026-06-13T20:24:00Z
**Researcher**: porebkon
**Git Commit**: f71b7e433fdb3dd62ce71f4e74767fa4bc76437e
**Branch**: master
**Repository**: MindTutor

## Research Question

Ground test-plan Phase 4 — "Grounding fidelity (the wedge)" — in current code. The
phase covers the **semantic remainder of Risk #1**: generated theory/exercise/feedback
*prose* contains claims not traceable to the uploaded source, which Phase 1's
deterministic, citation-only, 60k-truncated structural check (`findUngroundedCitation`,
`theory[].citation` only) cannot catch. An **AI-native LLM-judge** must prove every
factual claim in the generated prose maps to the source fixture and flag off-source
claims — while (a) honoring §4's "When NOT to use" boundary (don't re-check what a
deterministic span check already catches), and (b) avoiding the oracle problem (never
assert expected values lifted from the model's own output).

Two design forks were locked with the user before research (see Decisions Locked):
**live-call only** judge execution, and **all text fields** in scope (with distractor
special-casing).

## Summary

The semantic remainder is concrete and small. `findUngroundedCitation`
(`generate.ts:73-82`) validates **`theory[].citation` only** — a whitespace-normalized,
lowercased substring test against the **60k-truncated** source slice. **Every other
string field is unverified** for grounding: `theory[].body`, `theory[].heading`,
`exercises[].prompt`, the **correct** `exercises[].options[correctIndex]`,
`exercises[].feedback`, and `title`. These are the judge's scope.

**The distractor trap is the load-bearing design subtlety.** MCQ distractors
(`options[i]` for `i != correctIndex`) are *intentionally* plausible-but-wrong and
therefore deliberately absent from the source. A naive "every option must be grounded"
judge would false-flag every well-formed distractor. The judge must split each MCQ:
require grounding for `prompt`, the **correct** option, and `feedback`; **exempt** the
distractors. The correct option is identifiable pre-persistence via `correctIndex`
(`schema.ts:35`) and post-persistence via the dereferenced `correct_answer` string
(`index.ts:158`).

**The existing Phase 1 fixtures cannot exercise a semantic judge.** `buildValidSession`
(`completion-builder.ts:68-90`) emits **placeholder** prose — body `"Explanation for
step 1."`, prompt `"Question 1?"`, feedback `"Feedback for question 1."` — which asserts
no real fact. There is nothing on-source to confirm and nowhere to plant a hallucination.
Phase 4 must author a **new adversarial fixture set**: a richer source plus
hand-authored generated prose with **labeled** on-source (must PASS) and planted
off-source (must FLAG) claims, plus edge cases (claim grounded only in truncated-away
text → FLAG; legitimate distractor → must NOT flag). **The author-written label is the
oracle**, exactly as Phase 3 hand-computes scores and Phase 1 hand-labels the absent
citation — never the judge's own verdict.

**Live execution has a clean precedent to clone but a real gap to fill.** The judge's
model call reuses the existing seam (`getOpenRouterClient`/`getModel`,
`openrouter.ts:21-34`) and the proven JSON-mode parse path (`generate.ts:117-147`). The
**integration suite** is the template for an opt-in, keyed, non-default-`npm test`
suite: a separate Vitest config + npm script + a stub that injects **real** credentials
with fail-fast-if-missing (`vitest.integration.config.ts`, `src/test/integration/env.ts`).
The gaps: the default unit stub hands out a dummy `"test-key"` (a real call 401s), and
**no `OPENROUTER_API_KEY` secret exists in CI** (`ci.yml` references only Supabase +
Cloudflare). Phase 4's "optional after §3 Phase 4" CI gate (test-plan §5) needs that
secret + a conditional step.

**Stale-doc note surfaced:** test-plan §5 prose ("CI runs lint + build only",
`test-plan.md:135`) is now **stale** — `ci.yml:21` already runs `npm run test` (unit
suite). Worth a one-line fix when the plan touches §5/§6.6, but out of Phase 4 scope.

## Decisions Locked (pre-research, via AskUserQuestion)

1. **Judge execution: live-call only.** The judge always makes a *real* model call
   against adversarial fixtures; non-determinism is tolerated by making fixtures
   clear-cut (a planted hallucination MUST be flagged; a faithful paraphrase MUST pass).
   Consequence: the suite is keyed and non-deterministic, so it must live outside the
   default `npm test` (mirroring the integration suite), and its CI gate is opt-in. The
   plan must decide determinism controls (temperature 0 + JSON mode + possibly a fixed
   seed; possibly best-of-N majority for robustness) and the model id.
2. **Prose scope: all text fields, with distractor special-casing.** The judge grades
   `theory[].body`/`heading`, `exercises[].prompt`, the **correct** option, and
   `exercises[].feedback` (plus optionally `title`). Distractors are exempted by design
   — they are intentionally off-source.

## Detailed Findings

### A. The semantic remainder — every prose surface and who already covers it

`src/lib/services/generation/schema.ts` (every string field is `z.string().min(1)` —
zod enforces non-emptiness only, never grounding):

| String field | Schema loc | Grounded? | Covered by Phase 1? | Judge target? |
|---|---|---|---|---|
| `title` | `schema.ts:44` | conditional (label, not a span) | no | optional |
| `theory[].heading` | `schema.ts:24` | yes | no | **yes** |
| `theory[].body` | `schema.ts:25` | yes (core claim) | no | **yes (primary)** |
| `theory[].citation` | `schema.ts:26` | yes (verbatim) | **yes** (`findUngroundedCitation`) | **no — don't re-check** |
| `exercises[].prompt` | `schema.ts:33` | yes | no | **yes** |
| `exercises[].options[correctIndex]` | `schema.ts:34` | yes (correct answer) | no | **yes** |
| `exercises[].options[i≠correctIndex]` (distractors) | `schema.ts:34` | **no — intentionally off-source** | no | **exempt (special-case)** |
| `exercises[].feedback` | `schema.ts:36` | yes | no | **yes** |

The §4 "When NOT to use" boundary, concretely: the judge must **not** re-assert that
`theory[].citation` literally occurs in the source — that is exactly what
`findUngroundedCitation` already does for the right reason. The judge owns only the
*semantic* support of the remaining prose.

### B. The Phase 1 structural check — exact scope (the boundary)

`findUngroundedCitation(session, sourceText)` (`generate.ts:73-82`):

- Loops `session.theory`, reads **`step.citation`** only (`generate.ts:75-76`).
- `normalizeWhitespace` collapses `\s+`→single space + trims (`generate.ts:22-24`); both
  sides lowercased; match is `haystack.includes(needle)` (`generate.ts:77`).
- Against the **truncated** slice: `MAX_SOURCE_CHARS = 60_000` (`generate.ts:17`),
  `source = trimmed.slice(0, MAX_SOURCE_CHARS)` (`generate.ts:100`), same `source` passed
  at the call site (`generate.ts:149`).
- Checks **nothing else** — not `body`, `heading`, or any exercise field. (Confirmed by
  the Phase 1 retro, `test-plan.md:270-274`, and the Phase 1 research/plan boundary
  statements, `testing-generation-pipeline-contract/research.md:54-56`,
  `.../plan.md:91-93`.)

### C. The distractor trap (the design subtlety the plan must encode)

`McqSchema` (`schema.ts:30-41`): `correctIndex` is a non-negative int (`schema.ts:35`);
the only guard is `.refine(correctIndex < options.length)` (`schema.ts:38-41`) — a range
check, **no content constraint**. `options[correctIndex]` must be source-true; the other
options are wrong answers *by construction* and so deliberately not in the source. The
generation prompt instructs source-only facts (`generate.ts:48-61`), but that applies to
truthful content — distractors are intentionally false. **A judge that requires every
option to be grounded would false-positive on every good distractor.** The plan must:
grade `prompt` + correct option + `feedback`; exempt distractors (e.g. resolve the
correct option from `correctIndex` / `correct_answer` and pass only it).

### D. Persistence & display — the learner trusts the prose byte-for-byte

`src/pages/api/sessions/index.ts`:
- Theory → `generated_content` rows; `body` jsonb = `{heading, body, citation}`
  `satisfies TheoryBody` (`schema.ts:69`), stored **verbatim** (`index.ts:143-149,162`).
- Exercises → `exercises` rows storing `prompt`, full `options`, `feedback` verbatim;
  **key transform**: `correct_answer: mcq.options[mcq.correctIndex]` (`index.ts:158`) —
  the persisted correct answer is the option *string*, not an index.
- Display (`SessionRunner.tsx`): heading `:165`, body `:166`, citation in `<blockquote>`
  `:169`, prompt `:181`, options as buttons `:203`, feedback `:226`, title `:109` — all
  plain text, no transformation. `correct_answer` is gated until `answered_at != null`
  (`[id].astro:59`, `SessionRunner.tsx:18-20`) so the right option never leaks early.

Implication: the prose the judge grades = persisted strings = generated JSON. The judge
can run against the in-memory `GeneratedSession` (pre-persistence) for fixture tests; no
DB needed.

### E. Grounding corpus = the 60k-truncated slice the generator saw

`buildMessages` embeds the source verbatim: `SOURCE MATERIAL:\n"""\n${sourceText}\n"""`
(`generate.ts:63`), and the caller passes the **already-truncated** `source`
(`generate.ts:100,110`). The full text lives in `materials.extracted_text`
(`index.ts:140`), but the model only ever saw the first 60k chars. **The judge must
ground against the same 60k slice**, reconstructable as
`extracted_text.trim().slice(0, 60_000)`. Grounding against the full text would wrongly
*pass* claims supported only by truncated-away content; grounding against the slice
correctly *flags* them (mirrors the Phase 1 truncation-edge test,
`generate.session.test.ts:187-207`).

### F. Live model call — what to reuse, and the call+parse template

- **Seam:** `getOpenRouterClient()` (`openrouter.ts:21-29`, openai SDK →
  `https://openrouter.ai/api/v1`) throws if `OPENROUTER_API_KEY` is falsy — **a real
  call needs a real key**. `getModel()` returns `OPENROUTER_MODEL` (`openrouter.ts:32-34`).
  Env vars declared in `astro.config.mjs:17-29` (`OPENROUTER_API_KEY` server/secret;
  `OPENROUTER_MODEL` server/public, default `"openai/gpt-4o-mini"`).
- **JSON-mode parse path to mirror** (`generate.ts:117-147`): the `create` call sets
  `response_format: { type: "json_object" }` (`:120`), `temperature: 0.3` (`:121`),
  `max_tokens: 4000` (`:122`) — **no seed**. Then `JSON.parse` in try/catch (`:136-141`)
  → zod `safeParse` (`:143-147`). The judge should adopt this structure but set
  `temperature: 0` for reproducibility, and **throw on failure** (not silently degrade).
- **Second call+parse example:** `distill.ts:53-73` — `temperature: 0.3`, **no** JSON
  mode, and a **never-throw** fallback posture. Useful as a call shape, but its
  silent-degrade error handling is the **wrong** posture for a judge (a judge must emit
  a verdict, not swallow failure).
- **Verdict schema shape (for the plan):** a per-claim array, e.g.
  `{ field, claim, grounded: boolean, sourceSpan: string | null, reasoning: string }`,
  zod-validated like `schema.ts` does (`.object()` + `.array()` + `.refine()` for
  cross-field rules). The mock-completion shape stays
  `{ choices: [{ message: { content } }] }` (`openrouter-mock.ts:27-28`) — relevant only
  if any judge-wiring test stubs the call; the live suite uses the real client.

### G. Opt-in keyed suite — the integration-config precedent to clone

The integration suite is the working template for a keyed, non-deterministic,
out-of-default suite:
- **(a) separate config** `vitest.integration.config.ts` — distinct `astro:env/server`
  alias (`:38`) and include glob `src/**/*.integration.test.ts` (`:43`).
- **(b) separate script** `package.json:18` `"test:integration"`.
- **(c) excluded from default** — `vitest.config.ts:22` excludes `**/*.integration.test.ts`;
  `npm test` = `vitest run` (`package.json:16`).
- **(d) real creds, fail-fast** — `vitest.integration.config.ts:13-29` auto-loads creds;
  `src/test/integration/env.ts:11-24` reads them with a `required()` that names the fix
  if absent (opt-in by design — suite no-ops/throws when the stack is down).
- **Stub swap:** default unit stub `src/test/stubs/astro-env-server.ts:7-8` exports dummy
  `OPENROUTER_API_KEY="test-key"`; integration stub
  `src/test/stubs/astro-env-server.integration.ts:9-12` re-exports real Supabase creds
  only. A live-judge config would add a stub that exports a **real**
  `OPENROUTER_API_KEY` from `process.env` + a chosen model, fail-fast if missing.

### H. CI gap for the optional gate

`.github/workflows/ci.yml`: `ci` job runs `npm ci` → `astro sync` → `lint` →
**`npm run test`** (`:21`) → `build` (`:22`). Secrets present: `SUPABASE_URL`,
`SUPABASE_KEY` (`:24-25,41-42`), Cloudflare tokens (`:48-49`). **No
`OPENROUTER_API_KEY`** anywhere, and nothing runs a live model call. The §5 gate
("optional after §3 Phase 4", CI on PR / pre-merge, `test-plan.md:133`) needs: an
`OPENROUTER_API_KEY` repo secret, a new conditional step (`if: secrets.OPENROUTER_API_KEY
!= ''` — precedent: the deploy job's conditional `ci.yml:29`), and the `npm run
test:livejudge` script. Whether Phase 4 wires CI or just lands the local suite + names
the gate is a plan/cost×signal call (CI YAML authorship is explicitly out of this
lesson's scope per CLAUDE.md "Lesson boundaries").

## Code References

- `src/lib/services/generation/schema.ts:22-47` — all prose fields; `TheoryStepSchema`, `McqSchema`, `correctIndex` refine
- `src/lib/services/generation/schema.ts:69` — `TheoryBody` (persisted theory shape)
- `src/lib/services/generation/generate.ts:73-82` — `findUngroundedCitation` (citation-only structural check — the Phase 1/4 boundary)
- `src/lib/services/generation/generate.ts:17,100,110` — `MAX_SOURCE_CHARS = 60_000` truncation (the grounding corpus)
- `src/lib/services/generation/generate.ts:31-69` — `buildMessages` (source injection `:63`; grounding instructions `:48-61`)
- `src/lib/services/generation/generate.ts:117-147` — `create` call (JSON mode `:120`, temp `:121`) + JSON.parse + zod safeParse (judge's mirror)
- `src/lib/services/generation/openrouter.ts:21-34` — `getOpenRouterClient` / `getModel` (the live-call seam)
- `src/lib/services/onboarding/distill.ts:27-45,53-73` — second prompt + call+parse example (never-throw fallback = wrong posture for a judge)
- `src/pages/api/sessions/index.ts:143-163` — persistence; `correct_answer = options[correctIndex]` (`:158`)
- `src/components/session/SessionRunner.tsx:109,165-226` — display surfaces (learner-trusted prose)
- `src/pages/sessions/[id].astro:38-61` — read-back; `correct_answer` gated until answered (`:59`)
- `src/test/generation/completion-builder.ts:22-90` — `SMALL_SOURCE`, `CITATIONS`, `buildValidSession` (placeholder prose — insufficient for a judge), `buildLargeSource:100-111`
- `src/test/generation/openrouter-mock.ts:27-28` — `makeCompletion` shape
- `src/lib/services/scoring.test.ts:6-62` — hand-computed-oracle discipline (the anti-oracle pattern to follow)
- `src/lib/services/generation/generate.session.test.ts:122-207` — Phase 1 grounded/ungrounded/truncation cases via one-line overrides
- `vitest.config.ts:13,18,22` / `vitest.integration.config.ts:13-29,38,43-44` — default vs separate-config precedent
- `src/test/stubs/astro-env-server.ts:7-8` / `...integration.ts:9-12` — stub-swap pattern (dummy vs real creds)
- `src/test/integration/env.ts:11-24` — fail-fast real-credential load
- `astro.config.mjs:17-29` — env schema (`OPENROUTER_API_KEY` secret, `OPENROUTER_MODEL` default)
- `.github/workflows/ci.yml:21,24-25,29` — CI runs `npm run test`; no OpenRouter secret; conditional-job precedent

## Architecture Insights

- **The semantic remainder is precisely the complement of one substring check.** Phase 1
  bought verbatim-citation grounding cheaply and deterministically; Phase 4 owns *only*
  what a substring matcher cannot see — meaning-level support of `body`/`prompt`/correct
  option/`feedback`. This keeps the judge inside §4's "When NOT to use" boundary: it never
  re-checks `theory[].citation`.
- **Distractors invert the grounding assumption.** This is the one place where
  "not in the source" is *correct*, so the judge must be structure-aware (split MCQ
  fields by role) rather than treating the session as a flat bag of strings. Encode this
  in both the fixtures (a legitimate distractor as a must-NOT-flag control) and the judge
  prompt/scope.
- **The fixtures are the judge's oracle, and they must be authored, not generated.** The
  project's consistent discipline (hand-computed scores, hand-labeled absent citations)
  extends directly: positive (faithful paraphrase → PASS) and negative (planted
  off-source/contradiction → FLAG) cases are labeled by us. Feeding the judge a real
  model's output and asserting it passes would green-light current hallucination — the
  exact oracle anti-pattern §2 Risk #1 names.
- **Live + non-deterministic ⇒ a separate, opt-in, keyed suite.** The integration suite
  already proves the project can run an out-of-default, credentialed, fail-fast suite.
  The judge reuses that shape; it does not belong in `npm test`. Determinism is bought at
  the prompt level (temperature 0, JSON mode, unambiguous fixtures), not by stubbing —
  the user explicitly chose live-call only.

## Historical Context (from prior changes)

- `context/changes/testing-generation-pipeline-contract/research.md:29-30,54-56` &
  `.../plan.md:12-14,91-93` — Phase 1 explicitly **defers** the semantic body/feedback
  grounding judge to Phase 4 and pins the citation-only structural scope. Phase 4 is the
  named continuation, not a re-scope.
- `context/foundation/test-plan.md:270-274` (Phase 1 retro), `:96-98` (order rationale —
  Phase 4 last by cost×signal, depends on the Phase 1 harness), `:112` (§4 "When NOT to
  use"), `:133` (§5 optional gate), `:258-261` (§6.6 TBD cookbook slot Phase 4 must fill),
  `:70` (§2 Risk #1 oracle anti-pattern).
- Archived slices `2026-06-07-first-grounded-session` (S-01, introduced `citation`),
  `2026-06-08-per-session-intake-tailoring` (S-02), `2026-06-09-onboarding-bio-tailoring`
  (S-03) — establish the generation path but contain **no prior judge/evaluation work**.
  Phase 4 is greenfield for AI-native testing in this repo.

## Related Research

- `context/changes/testing-generation-pipeline-contract/research.md` — the structural
  Phase 1 grounding research this phase continues (the substring check, the 60k
  truncation, the OpenRouter seam, the completion-builder fixtures).
- `context/foundation/test-plan.md` §1, §2 (Risk #1 + Risk Response row), §3 Phase 4,
  §4 (AI-native stack row + "When NOT to use"), §5 (optional gate), §6.6 (TBD slot).

## Open Questions (for /10x-plan)

1. **Model id for the judge.** `OPENROUTER_MODEL` defaults to `openai/gpt-4o-mini`; a
   grounding judge may warrant a stronger/more-faithful model. The judge is itself an LLM
   application — consult the `claude-api` skill / latest-model guidance when the plan
   picks the model and call params (temperature 0, JSON mode, seed, best-of-N).
2. **Verdict robustness vs. cost.** Single call vs. best-of-N majority to tame
   non-determinism; how many adversarial fixtures are "enough" signal at the per-PR cost.
3. **Judge wiring determinism.** Does the plan also want a *deterministic* unit over the
   judge's parse/threshold logic (stubbed verdict) alongside the live suite — or is the
   live suite the whole deliverable? (User chose "live-call only" for the *grounding*
   assertion; a thin parse-logic unit is a separate, optional safety net the plan may
   still add.)
4. **CI gate now or later.** Land the local `test:livejudge` suite + name the gate, vs.
   also wiring the `OPENROUTER_API_KEY` secret + conditional CI step (CI YAML authorship
   is out of this lesson's scope per CLAUDE.md — likely "name it, don't wire it").
5. **Claim extraction granularity.** Does the judge decompose `body`/`feedback` into
   atomic claims (finer flags, more calls) or judge each field whole (coarser, cheaper)?
6. **Stale §5 doc fix.** `test-plan.md:135` ("CI runs lint + build only") contradicts
   `ci.yml:21` (`npm run test`). Tiny correction to fold in when the plan edits §5/§6.6.
