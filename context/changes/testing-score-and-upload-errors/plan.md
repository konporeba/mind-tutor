# Score Correctness + Upload/Parse Error Surfacing (test-plan Phase 3) Implementation Plan

## Overview

Rollout Phase 3 of `context/foundation/test-plan.md`. Add the tests that prove two
risks are defended, at the cheapest layer that gives a real signal (§1 cost×signal):

- **Risk #4 — Performance score miscomputed.** Prove the score equals an
  **independently-computed** percentage correct over a fixture of known answers,
  aggregating across MCQ and any future exercise type — not merely that a number is present.
- **Risk #5 — Upload / parse error not surfaced.** Prove a corrupt/oversize/unsupported/
  empty-extraction input yields a clean explanatory error **before generation runs** —
  never a silent break or an opaque error.

This is a **test-authoring** phase (Module 3). It adds test code and updates the
test-plan cookbook. It does **not** change production code.

## Current State Analysis

Grounded by `research.md` (status: complete) against commit `075a83f`:

- **Score (#4) has a single-source-of-truth design.** `computeScore()`
  (`src/lib/services/scoring.ts:12`) is a pure function: `Math.round(correct/total*100)`
  where `correct = count(is_correct === true)`, empty set → `0`. It is **kind-agnostic**
  (reads only `is_correct`, never `kind`), so MCQ and future types aggregate identically.
  Called once, server-side, from `POST /api/sessions/[id]/complete` (`complete.ts:51`);
  the client only **displays** the server value (`SessionRunner.tsx:91-92`). No second,
  drift-prone score path exists.
- **Upload validation (#5) is defended at two layers.** Client: `validateFile()` /
  `extensionOf()` (`parseFile.ts:12-26`) are **pure and import-safe** (pdf.js is lazily
  imported only inside `parsePdf`, per `lessons.md`), so they unit-test in `node` env with
  no jsdom/mocks. Server (the trust boundary): `POST /api/sessions` re-validates four
  conditions in four guard clauses (`sessions/index.ts:60-71`), all `return 400` **before**
  the first DB read (`:90`) and `generateSession` (`:96`).
- **Test base & harness.** Vitest `^4.1.8`, `node` env, `@/*` alias, `astro:env/server`
  stubbed. Default `npm test` (`vitest.config.ts`, includes `src/**/*.test.ts`) is
  Supabase-free. A separate DB-backed integration harness exists from Phase 2
  (`*.integration.test.ts`, `npm run test:integration`) — **not used by this phase**.
  Reference pure units: `src/lib/services/generation/sizing.test.ts`, `generate.test.ts`
  (§6.1, no mocks).
- **Limits are duplicated, not shared:** `MAX_SIZE_BYTES` / `ALLOWED_EXTENSIONS` are copied
  in `parseFile.ts:9-10` and `sessions/index.ts:20-21`. Drift between the copies is a real
  (currently untested) risk.

## Desired End State

`npm test` runs three new test files, all green:

- `src/lib/services/scoring.test.ts` — pins the score contract with a hand-computed oracle.
- `src/components/session/lib/parseFile.test.ts` — pins the client type/size gate + extension parsing.
- `src/pages/api/sessions/index.test.ts` — pins the four server bad-input guards return `400`
  with the right message **and** `generateSession` is never reached.

`context/foundation/test-plan.md` is updated: §6.4 and §6.5 are filled (no longer "TBD"),
§6.7 has a Phase 3 note, §7 records the deliberately-untested client-form surface, and the
§3 Phase 3 row reads `complete`.

**Verify:** `npm test` passes including the three new files; `npm run lint` and
`npx astro check` (typecheck) pass; `test-plan.md` §6.4/§6.5 contain concrete
location/naming/reference-test/run-command guidance; §3 row 3 = `complete`.

### Key Discoveries:

- `src/lib/services/scoring.ts:12-19` — `computeScore`: the entire #4 computation, pure,
  kind-agnostic; `is_correct === null` (unanswered) counts as incorrect (deliberate).
- `src/components/session/lib/parseFile.ts:9-26` — `MAX_SIZE_BYTES`, `ALLOWED_EXTENSIONS`,
  `extensionOf`, `validateFile`: pure, import-safe (type-only top-level import; pdf.js lazy).
- `src/pages/api/sessions/index.ts:60-71` — the four server bad-input guards, ordered:
  (1) `!(file instanceof File)` → "No file provided"; (2) empty/non-string `extractedText`
  → "Could not read any text from the file"; (3) bad extension → "Unsupported file type…";
  (4) `size > MAX_SIZE_BYTES` → "File exceeds the 20 MB limit." All `return 400`.
- `sessions/index.ts:45,50,56,60-71,90,96` — ordering invariant: auth → `createClient` →
  `formData()` → four guards → intake parse → profile read (first DB) → `generateSession`.
- Reference test conventions: `src/lib/services/generation/sizing.test.ts` (pure unit, §6.1);
  `src/test/generation/openrouter-mock.ts` (the `vi.mock` + `vi.hoisted` seam pattern, §6.2).

## What We're NOT Doing

- **No DB-backed integration test for #4.** Decision (cost×signal): the pure unit fully
  pins the score *math*; the answer→aggregate→persist *wiring* is asserted indirectly by
  Phase 2's existing owner-200 control (`complete.integration.test.ts` asserts
  `typeof body.score === "number"`). We do **not** extend `createSessionGraph` to seed
  multiple exercises this phase.
- **No jsdom / React Testing Library.** The React form's own empty-guard + corrupt-catch
  (`NewSessionForm.tsx:54-81`) is not cheaply testable without adding a framework to the
  stack. We cover the trust boundary at the server layer and record the client-form
  surfacing in §7 negative-space.
- **No production refactor of the duplicated limits.** We do not de-duplicate
  `MAX_SIZE_BYTES`/`ALLOWED_EXTENSIONS` into a shared module. Instead, both test layers
  assert the same bad inputs, so drift surfaces as a test failure.
- **No e2e, no Playwright, no AI-native judge.** Out of scope (§4); grounding is Phase 4.
- **No CI YAML.** §5 names the gate ("required after §3 Phase 3"); wiring it into CI is owned
  by the Module-1/Module-2 CI lessons, not this phase.

## Implementation Approach

Three phases, each a discrete unit. Phases 1 and 2 add test files under default `npm test`
(node env, no DB, no network). Phase 3 makes the cookbook canonical and closes the rollout
row. The #4 and #5 risks split cleanly into Phases 1 and 2; docs land last so they describe
the patterns exactly as shipped.

The single non-obvious assertion is in Phase 2's route test: **prove generation is never
reached** on bad input (a spy on `generateSession`, asserted `not.toHaveBeenCalled()`). This
pins the "before generation runs" ordering invariant — it would fail if a future refactor
moved validation after generation.

## Critical Implementation Details

- **Guard ordering (Phase 2 route test).** The four guards run in sequence
  (`sessions/index.ts:60-71`). To exercise guard *N*, the fixture must satisfy guards
  *1..N-1*. E.g. the "unsupported extension" case needs a real `File` **and** a non-empty
  `extractedText`; the "oversize" case additionally needs an allowed extension. Build each
  bad-input `FormData` as otherwise-valid up to the guard under test.
- **Two mock seams, no DB/network (Phase 2 route test).** `createClient` (`@/lib/supabase`)
  must be mocked to return a dummy **non-null** object (to clear the `:51` 500 guard);
  `generateSession` (`@/lib/services/generation/generate`) must be a `vi.fn` spy. Both the
  profile read (`:90`) and generation (`:96`) sit *after* the guards, so neither real
  Supabase nor real OpenRouter is touched. Follow the `vi.hoisted` + `vi.mock` pattern from
  §6.2 / `src/test/generation/openrouter-mock.ts` (the spy must be hoisted because `vi.mock`
  is hoisted above imports).
- **Independent oracle, not a lifted value (Phase 1).** Expected percentages must be
  computed by hand in the fixture, never copied from `computeScore`'s output — that is the
  §2 Risk #4 anti-pattern (oracle problem). `Math.round` rounds .5 toward +∞; the 1/8→13
  row pins this explicitly.

## Phase 1: Score correctness unit (Risk #4)

### Overview

A pure unit test on `computeScore` with an independently-computed oracle fixture that pins
the full contract: percentage rounding, empty-set zero, unanswered-as-incorrect, and
kind-agnostic aggregation.

### Changes Required:

#### 1. Score unit test

**File**: `src/lib/services/scoring.test.ts`

**Intent**: Prove the score equals a hand-computed percentage correct over a known-answer
fixture, across MCQ and a synthetic future exercise type — satisfying §2 Risk #4 ("score
equals an independently-computed percentage correct … across MCQ and future exercise types")
and avoiding the oracle anti-pattern. Co-located beside `scoring.ts` per §6.1; no mocks.

**Contract**: Calls `computeScore(fixture)` and asserts the hand-computed expected integer.
Fixture rows are `Pick<Exercise, "is_correct">` (plus a `kind` field on the mixed-kind row to
demonstrate kind-agnosticism — `computeScore` ignores it). Required cases:
- `[]` → `0` (empty-set rule)
- 3 × `is_correct: true` → `100` (all-correct)
- 1 true / 3 total → `33`; 2 true / 3 total → `67` (the rounding pair)
- 1 true / 8 total → `13` (`Math.round(12.5)` rounds toward +∞ — pins the rounding rule)
- 2 true / 1 false / 2 `null` of 5 total → `40` (pins "unanswered/null counts as incorrect")
- mixed-kind fixture (an `mcq` row + a synthetic `kind` row, mix of `is_correct`) → the
  hand-computed percent (proves aggregation never inspects `kind`)

### Success Criteria:

#### Automated Verification:

- New file `src/lib/services/scoring.test.ts` exists and is picked up by Vitest
- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Every expected value in the fixture is computable by hand from the fixture rows (no value
  lifted from `computeScore`); a reviewer can re-derive each percent independently
- The unanswered-`null` case and the half-rounding case are present and asserted

**Implementation Note**: After automated verification passes, pause for human confirmation
that the oracle values were independently re-derived before proceeding to Phase 2.

---

## Phase 2: Upload/parse error surfacing (Risk #5)

### Overview

Two test files at the two cheap layers: a pure unit on the client type/size gate, and a
route-level test on the server's four bad-input guards proving each returns a clean `400`
**before** generation. The 21 MB / `.docx` inputs are asserted at **both** layers so drift
between the duplicated limit constants surfaces as a failure.

### Changes Required:

#### 1. Client validation pure unit

**File**: `src/components/session/lib/parseFile.test.ts`

**Intent**: Pin the client-side type/size gate and extension parsing at file-pick time
(§2 Risk #5 "unsupported/oversize … clean explanatory error"). These functions are pure and
import-safe, so the test runs in `node` env with no mocks and no jsdom (§6.1).

**Contract**: Imports `validateFile`, `extensionOf`, `MAX_SIZE_BYTES`, `ALLOWED_EXTENSIONS`
from `parseFile.ts`. `validateFile` cases (construct `File` objects; oversize via a
`File` whose `size` exceeds the limit — a sparse blob or a stubbed `size`):
- unsupported extension (e.g. `notes.docx`) → `"Unsupported file type. Upload a PDF, .txt, or .md file."`
- oversize (21 MB, allowed extension) → `"File exceeds the 20 MB limit."`
- each allowed type (`.pdf`, `.txt`, `.md`, within size) → `null`
`extensionOf` edge cases: no dot (`"README"` → `""`), uppercase (`"a.PDF"` → `"pdf"`),
dotfile (`".gitignore"` → `"gitignore"`), double extension (`"notes.pdf.exe"` → `"exe"`,
`"archive.tar.gz"` → `"gz"`).

#### 2. Server bad-input guard route test

**File**: `src/pages/api/sessions/index.test.ts`

**Intent**: Prove each of the four server guards returns a clean `400` with the right message
**and that `generateSession` is never called** — pinning the "before generation runs"
ordering invariant (§2 Risk #5; the empty-`extractedText` case is the must-challenge "empty
means no content, so proceed"). Runs under default `npm test` (no DB, no network).

**Contract**: `vi.mock("@/lib/supabase")` so `createClient` returns a dummy non-null object;
`vi.mock("@/lib/services/generation/generate")` exposing `generateSession` as a `vi.fn` spy
(hoisted via `vi.hoisted` per §6.2). Invoke the route's `POST` with a faked `APIRoute`
context: `locals.user` = a dummy user, `request` = a `Request` carrying a real `FormData`
body, plus `cookies`. One case per guard (each FormData otherwise-valid up to its guard, per
Critical Implementation Details → guard ordering):
- no file (omit `file`) → `400` `"No file provided"`
- empty `extractedText` (real file present) → `400` `"Could not read any text from the file"`
- unsupported extension (`.docx`, valid file + non-empty text) → `400` `"Unsupported file type. Upload a PDF, .txt, or .md file."`
- oversize file (21 MB, allowed extension, non-empty text) → `400` `"File exceeds the 20 MB limit."`

Every case additionally asserts `expect(generateSession).not.toHaveBeenCalled()`. The `.docx`
and 21 MB cases mirror the client unit's inputs so the duplicated limits cannot drift silently.

### Success Criteria:

#### Automated Verification:

- New files `parseFile.test.ts` and `sessions/index.test.ts` exist and are picked up by Vitest
- Unit + route tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- No real Supabase or OpenRouter is contacted (test runs offline; `npm test` stays Supabase-free)

#### Manual Verification:

- Each of the four route cases asserts both the `400` + exact message **and**
  `generateSession` not called
- The empty-`extractedText` case is present (the §2 must-challenge scenario)
- The `.docx` and 21 MB inputs are asserted at **both** the client unit and the server route
  (drift guard)

**Implementation Note**: After automated verification passes, pause for human confirmation
that the spy-not-called assertion is present on all four route cases before proceeding to
Phase 3.

---

## Phase 3: Cookbook & plan docs

### Overview

Make `test-plan.md` canonical for the patterns this phase shipped: fill §6.4 and §6.5,
append a §6.7 note, record the deliberately-untested client-form surface in §7, and close the
§3 Phase 3 row. Doc-only.

### Changes Required:

#### 1. Cookbook §6.4 — score / aggregation test

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.4 "TBD" with the concrete pattern as shipped in Phase 1.

**Contract**: §6.4 states location & naming (`*.test.ts` co-located beside the scoring
module; `npm test`), the reference test (`src/lib/services/scoring.test.ts`), the
**independent-oracle rule** (compute expected percent by hand; never lift from the code —
§2 anti-pattern), and the kind-agnostic-fixture technique. No mocks.

#### 2. Cookbook §6.5 — upload / parse error-path test

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.5 "TBD" with the two-layer pattern as shipped in Phase 2.

**Contract**: §6.5 documents (a) the client pure unit (`parseFile.test.ts`, no mocks,
import-safe) and (b) the server route-guard test (`sessions/index.test.ts`: mock
`createClient` non-null, spy `generateSession`, assert `400` + message **and** spy
not-called = the "before generation" invariant), the run command (`npm test`), and the
both-layers drift-guard note for the duplicated limits.

#### 3. §6.7 per-phase note, §7 negative-space, §3 status, §5 gate

**File**: `context/foundation/test-plan.md`

**Intent**: Append the Phase 3 §6.7 note (2–3 lines: the independent-oracle discipline; the
spy-not-called invariant; limits duplicated → asserted at both layers). Add a §7 entry: the
React New-Session form's own empty-guard/corrupt-catch surfacing is deliberately untested at
the UI layer (no jsdom/RTL in the stack) — the trust boundary is covered server-side instead;
re-evaluate if jsdom/RTL is added. Flip the §3 Phase 3 row Status to `complete`. Update the §5
"score + upload-error tests" gate row context if needed (the gate is now satisfiable locally).

#### 4. Change identity

**File**: `context/changes/testing-score-and-upload-errors/change.md`

**Intent**: Set `status: complete` (or per the orchestrator's vocabulary) and `updated` to
the implementation date once Phase 3 lands.

**Contract**: Front-matter `status` + `updated` fields only.

### Success Criteria:

#### Automated Verification:

- §6.4 and §6.5 in `test-plan.md` no longer contain "TBD — see §3 Phase 3"
- §3 Phase 3 row Status reads `complete`
- Markdown lints/formats clean (Prettier via pre-commit on `*.md`)

#### Manual Verification:

- §6.4/§6.5 give a new contributor enough to add a score or upload-error test without
  re-reading the source (location, naming, reference test, run command, key rule)
- §7 entry accurately states what is not tested and why, with a re-evaluation trigger
- §6.7 Phase 3 note captures the oracle discipline and the spy-not-called invariant

**Implementation Note**: Doc-only phase; no app behavior to verify manually beyond reading
the updated guide for accuracy.

---

## Testing Strategy

### Unit Tests:

- `computeScore` contract (Phase 1): empty, all-correct, rounding pair, half-round,
  unanswered-null, mixed-kind — all against a hand-computed oracle.
- `validateFile` / `extensionOf` (Phase 2): unsupported type, oversize, each allowed type,
  extension edge cases (no dot, uppercase, dotfile, double extension).

### Integration Tests:

- None added this phase (decision: DB-backed #4 integration deferred; see "What We're NOT
  Doing"). The Phase 2 route test is an in-process route invocation with mocked seams, run
  under default `npm test`, not the DB-backed integration harness.

### Manual Testing Steps:

1. Run `npm test`; confirm the three new files appear and pass.
2. Spot-check one oracle value (e.g. 2 true / 1 false / 2 null → 40) by hand.
3. Temporarily comment out one server guard locally → confirm the corresponding route test
   fails (and the spy-not-called assertion fires) → revert. (Sanity that the test bites.)

## Performance Considerations

None — all three files are fast, offline, node-env tests. No DB, no network, no jsdom.

## Migration Notes

None — additive test files plus documentation edits; no production code or schema changes.

## References

- Related research: `context/changes/testing-score-and-upload-errors/research.md`
- Test plan / quality contract: `context/foundation/test-plan.md` (§2 Risks #4/#5, §6.1/§6.2 patterns)
- Score: `src/lib/services/scoring.ts:12`; call site `src/pages/api/sessions/[id]/complete.ts:51`
- Upload gate: `src/components/session/lib/parseFile.ts:12-26`
- Server guards: `src/pages/api/sessions/index.ts:60-71` (ordering: `:45,50,56,90,96`)
- Reference units: `src/lib/services/generation/sizing.test.ts`; mock seam `src/test/generation/openrouter-mock.ts`
- SSR lazy-import rule: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Score correctness unit (Risk #4)

#### Automated

- [x] 1.1 New file `src/lib/services/scoring.test.ts` exists and is picked up by Vitest — cb4f11b
- [x] 1.2 Unit tests pass: `npm test` — cb4f11b
- [x] 1.3 Type checking passes: `npx astro check` — cb4f11b
- [x] 1.4 Linting passes: `npm run lint` — cb4f11b

#### Manual

- [x] 1.5 Every expected value is independently hand-derivable (no value lifted from `computeScore`) — cb4f11b
- [x] 1.6 The unanswered-`null` case and the half-rounding case are present and asserted — cb4f11b

### Phase 2: Upload/parse error surfacing (Risk #5)

#### Automated

- [x] 2.1 New files `parseFile.test.ts` and `sessions/index.test.ts` exist and are picked up by Vitest
- [x] 2.2 Unit + route tests pass: `npm test`
- [x] 2.3 Type checking passes: `npx astro check`
- [x] 2.4 Linting passes: `npm run lint`
- [x] 2.5 No real Supabase or OpenRouter is contacted (test runs offline)

#### Manual

- [x] 2.6 Each route case asserts the `400` + exact message **and** `generateSession` not called
- [x] 2.7 The empty-`extractedText` case is present (the §2 must-challenge scenario)
- [x] 2.8 `.docx` and 21 MB inputs are asserted at both the client unit and the server route (drift guard)

### Phase 3: Cookbook & plan docs

#### Automated

- [ ] 3.1 §6.4 and §6.5 no longer contain "TBD — see §3 Phase 3"
- [ ] 3.2 §3 Phase 3 row Status reads `complete`
- [ ] 3.3 Markdown lints/formats clean

#### Manual

- [ ] 3.4 §6.4/§6.5 are sufficient to add a new test without re-reading the source
- [ ] 3.5 §7 entry accurately states what is not tested, why, and a re-evaluation trigger
- [ ] 3.6 §6.7 Phase 3 note captures the oracle discipline and the spy-not-called invariant
