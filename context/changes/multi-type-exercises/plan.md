# Multi-type Exercises (S-04) Implementation Plan

## Overview

Extend the MindTutor session loop from MCQ-only exercises to three grounded
exercise types — **multiple choice (mcq)**, **fill-in-the-blank (fill_blank)**,
and **matching pairs (matching)** — generated together per session, graded
server-side, and rendered in the session runner. This completes FR-009 (full),
replacing the MCQ-only partial shipped in S-01.

The load-bearing invariant: **every exercise, regardless of type, resolves to a
single `is_correct` boolean**, so the existing percent-correct score
(`computeScore`) aggregates across the three types with no change.

## Current State Analysis

The S-01/S-02 pipeline is single-type (MCQ) but already structurally close:

- **Generation** (`src/lib/services/generation/schema.ts`, `generate.ts`): one
  validated + grounded OpenRouter call. `exercises` is hard-typed as
  `McqSchema[]` with `.length(sizing.mcqCount)`. The prompt and a sizing-derived
  zod schema are built together so retries validate against what the prompt
  asked for.
- **Sizing** (`src/lib/services/generation/sizing.ts`): `SessionSizing` carries a
  single `mcqCount`; `COUNTS_BY_BUDGET` maps the 15/30/60-minute budget to
  theory bounds + `mcqCount`, monotonic by budget (asserted in `sizing.test.ts`).
- **Persistence** (`src/pages/api/sessions/index.ts:151`): each MCQ →
  one `exercises` row with `kind:'mcq'`, `options` (jsonb string[]),
  `correct_answer = options[correctIndex]` (a bare jsonb string), `feedback`.
- **Grading** (`src/pages/api/sessions/[id]/exercises/[exerciseId].ts:55`): inline
  `exercise.correct_answer === parsed.answer` string equality; `AnswerSchema` is
  `{ answer: string }`. This is the single grading site.
- **Scoring** (`src/lib/services/scoring.ts:12`): `computeScore` = rounded percent
  of rows with `is_correct === true`. **Already type-agnostic.**
- **UI** (`src/components/session/SessionRunner.tsx`): renders `options` as MCQ
  buttons only; `ExerciseView.options: string[]`. `[id].astro` loads exercise
  rows and only exposes `correct_answer` for already-answered items.
- **DB** (`supabase/migrations/20260528202720_domain_schema_rls_baseline.sql:120`):
  `exercises.kind` is `text default 'mcq'` with **no CHECK constraint**;
  `options` / `correct_answer` / `learner_answer` are all `jsonb`. New types fit
  the existing columns — no column migration required.

### Key Discoveries

- `computeScore` (`scoring.ts:12`) counts `is_correct` and is already
  type-blind — the roadmap's headline "score still aggregates" risk is
  pre-mitigated **provided matching is all-or-nothing** (one `is_correct` per
  item, per the chosen design).
- `exercises.kind` has no DB CHECK constraint and the answer columns are `jsonb`,
  so the only schema change is an **optional hardening CHECK migration** (chosen:
  add it). Existing rows are all `'mcq'`, so the constraint is safe to add.
- Grading lives inline in exactly one endpoint (`[exerciseId].ts:55`). Extracting
  it to a pure module is a small, well-contained refactor that makes per-type
  grading unit-testable (the chosen test layer).
- The MCQ `correct_answer` is persisted as the option **text** (a jsonb string),
  not the index — fill_blank and matching will persist richer jsonb objects;
  grading branches on `kind`, so mixed `correct_answer` shapes coexist cleanly.
- `[id].astro:48` already gates `correct_answer` behind `answered_at` — the same
  gate must hold for matching's correct mapping; the **displayable** parts
  (left items + shuffled right column) live in `options` and are safe pre-answer.

## Desired End State

A learner starting a session receives a mix of MCQ, fill-in-the-blank, and
matching-pairs exercises (counts set by the time budget). Each renders with its
own UI, is graded server-side, and contributes one correct/incorrect result to
the percent score. History replay and the milestone bar work unchanged. Verify
by running a full session, answering one of each type, and seeing a coherent
score; `npm run lint`, `npm run build`, and `npx vitest run` pass.

## What We're NOT Doing

- **No partial credit** for matching — a matching item is all-or-nothing (one
  `is_correct`). `computeScore` is untouched.
- **No LLM in the grading path** — fill-blank uses deterministic
  normalized-equality against an accepted-answers set; no per-answer model calls.
- **No new exercise types beyond these three**, no per-domain/subject-adaptive
  type, no image-based items.
- **No generation-harness "mix assertion" test and no E2E here** — unit coverage
  is sizing distribution + per-type grading. Browser-level coverage stays with
  `/10x-e2e`.
- **No `options`/`correct_answer` column changes** — reusing existing `jsonb`.
- **No drag-and-drop / click-to-pair** matching UI — dropdown-per-left only.

## Implementation Approach

Work outward from the deterministic core: first the generation contract + sizing
(pure, unit-tested), then persistence + the extracted grading module + the
hardening migration, then the UI renderers. Each phase leaves the app building
and the prior type working. Heterogeneous exercises are modeled as a
**kind-discriminated union** in the generation schema; persistence flattens each
variant into the existing `exercises` columns; grading and rendering branch on
`kind`.

## Critical Implementation Details

- **Matching shuffle must happen once, at persistence time**, and be stored in
  `options` — never re-shuffled per render. The learner's submitted mapping is
  graded against the stored truth; a render-time reshuffle would desync the
  displayed right-column order from what was graded.
- **Never leak the matching solution pre-answer.** `options` holds
  `{ left[], right[] }` (right already shuffled) and is safe to send; the correct
  mapping lives in `correct_answer` and must stay gated behind `answered_at` in
  `[id].astro`, exactly as MCQ's `correct_answer` is today.
- **Sizing/schema must agree per type across retries.** Compute sizing once
  (already done at `generate.ts:105`) and derive both the prompt counts and the
  union's per-type count validation from the same `SessionSizing`.

## Phase 1: Generation contract & sizing

### Overview

Turn the single MCQ schema into a kind-discriminated union of three item types,
extend sizing to carry per-type counts, and update the prompt to request the mix.
Validation enforces exact per-type counts with the existing retry-once-then-fail
behavior.

### Changes Required:

#### 1. Per-type exercise counts in sizing

**File**: `src/lib/services/generation/sizing.ts`

**Intent**: Replace the single `mcqCount` with per-type counts so the budget
drives a fixed mix. Keeps the map pure and monotonic-by-budget.

**Contract**: `SessionSizing.mcqCount: number` → `SessionSizing.exerciseCounts:
{ mcq: number; fill_blank: number; matching: number }`. `COUNTS_BY_BUDGET`
becomes (theory bounds unchanged):

| Budget | theoryMin–Max | mcq | fill_blank | matching | total |
| ------ | ------------- | --- | ---------- | -------- | ----- |
| 15     | 2–3           | 2   | 1          | 1        | 4     |
| 30     | 3–4           | 3   | 1          | 1        | 5     |
| 60     | 4–6           | 4   | 2          | 2        | 8     |

Each per-type count is monotonic non-decreasing by budget, and the total is too
(4 ≤ 5 ≤ 8) — preserves the existing monotonicity invariant. `depthGuidance`
unchanged.

#### 2. Kind-discriminated exercise schemas + count validation

**File**: `src/lib/services/generation/schema.ts`

**Intent**: Model the three exercise types as a discriminated union and validate
that a generated session contains exactly the per-type counts from sizing.

**Contract**: Add three item schemas, each with a `kind` literal discriminant and
`position` (a single 0-based sequence across all exercises):

- `McqSchema`: add `kind: z.literal("mcq")`; keep `prompt`, `options`
  (3–5 strings), `correctIndex`, `feedback`, and the existing `correctIndex <
  options.length` refinement.
- `FillBlankSchema`: `kind: z.literal("fill_blank")`, `prompt` (must contain a
  blank marker `___`), `answer: string`, `acceptable: z.array(z.string()).default([])`
  (additional accepted variants, excluding `answer`), `feedback`.
- `MatchingSchema`: `kind: z.literal("matching")`, `prompt`, `pairs:
  z.array(z.object({ left: z.string().min(1), right: z.string().min(1) }))
  .min(4).max(6)`, `feedback`.

`ExerciseItemSchema = z.discriminatedUnion("kind", [Mcq, FillBlank, Matching])`.
`makeGeneratedSessionSchema(sizing)` returns `{ title, theory (bounds from
sizing), exercises: z.array(ExerciseItemSchema).superRefine(...) }` where the
refinement asserts `count(kind===k) === sizing.exerciseCounts[k]` for each of the
three kinds (a count mismatch fails validation → triggers the existing retry).
Export `Mcq`, `FillBlank`, `Matching`, `ExerciseItem` inferred types. Keep
`GeneratedSessionSchema` (the no-intake fallback) consistent by giving it a
default sizing.

#### 3. Prompt requests the typed mix

**File**: `src/lib/services/generation/generate.ts`

**Intent**: Update `buildMessages` so the model emits the discriminated items at
the exact per-type counts, preserving all S-01 grounding rules.

**Contract**: The JSON-shape description in the `system` message replaces the
single MCQ array spec with a per-kind spec naming `sizing.exerciseCounts.mcq`
mcq items, `.fill_blank` fill_blank items (prompt contains `___`, one `answer`
plus optional `acceptable` variants), and `.matching` matching items (4–6
`pairs` of `{left,right}`). Each item carries its `kind`. Grounding sentences
(use only the source, citations verbatim) stay authoritative and unchanged.
`buildMessages` stays pure (still exported for tests).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Sizing distribution unit tests pass: `npx vitest run src/lib/services/generation/sizing.test.ts`
- Existing generation unit tests pass (updated for the union): `npx vitest run src/lib/services/generation`

#### Manual Verification:

- For each budget, the per-type counts sum to the intended total and are
  monotonic non-decreasing across 15→30→60 (covered by the sizing test, eyeball
  the recipe table once).

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Persistence, grading & data hardening

### Overview

Map each generated item to an `exercises` row by kind (shuffling matching's right
column once at write), extract grading into a pure per-type module, refactor the
answer endpoint to use it, and add the `exercises.kind` CHECK-constraint
migration.

### Changes Required:

#### 1. Per-type row persistence — ✅ LANDED EARLY IN PHASE 1

> Pulled forward: changing `generated.exercises` to a discriminated union forced
> this map to handle all three kinds for the tree to type-check/lint. Implemented
> in Phase 1 (including the `shuffle` helper). Verify the contract below still
> holds, but the code change is done.

**File**: `src/pages/api/sessions/index.ts`

**Intent**: Replace the MCQ-only `exerciseRows` map with a per-kind mapping that
flattens each union variant into the existing columns, hiding solutions from
`options`.

**Contract**: Build one row per generated exercise, branching on `kind`:

- `mcq` (unchanged): `options = options[]`, `correct_answer = options[correctIndex]`.
- `fill_blank`: `options = null`, `correct_answer = { answer, acceptable }` (jsonb).
- `matching`: `options = { left: pairs.map(p=>p.left), right: shuffle(pairs.map(p=>p.right)) }`
  (jsonb; right shuffled **once** here), `correct_answer = { pairs }` (the truth
  mapping). All rows carry `kind`, `position`, `prompt`, `feedback`, `user_id`,
  `session_id`. A small local `shuffle` helper (Fisher–Yates) is acceptable.

#### 2. Pure per-type grading module

**File**: `src/lib/services/grading.ts` (new)

**Intent**: Centralize correctness logic for all three kinds as a pure function so
it is unit-testable independent of HTTP/DB.

**Contract**: `gradeAnswer(input: { kind: string; correct_answer: unknown;
submitted: unknown }): boolean`.

- `mcq`: `submitted` (string) strictly equals `correct_answer` (string).
- `fill_blank`: `normalize(submitted)` is in `{ normalize(answer), ...acceptable.map(normalize) }`,
  where `normalize` = trim + collapse internal whitespace + lowercase.
- `matching`: `submitted` is a left→right mapping; correct iff for every
  `{left,right}` in `correct_answer.pairs`, the submitted right for `left` equals
  `right` (order-insensitive, all pairs must match — all-or-nothing).

Malformed `submitted` for the kind returns `false` (the endpoint additionally
rejects malformed shapes with 400; see below).

#### 3. Answer endpoint branches on kind

**File**: `src/pages/api/sessions/[id]/exercises/[exerciseId].ts`

**Intent**: Load the exercise's `kind`, validate the submitted answer's shape per
kind, grade via the pure module, and return a kind-appropriate reveal.

**Contract**: Select `kind, correct_answer, feedback` (add `kind`). Replace the
single `AnswerSchema` with a per-kind parse: `mcq`/`fill_blank` → `{ answer:
string }`; `matching` → `{ answer: Record<string,string> }` (left→right). On
parse failure return 400. Compute `is_correct = gradeAnswer({kind,
correct_answer, submitted})`, persist `learner_answer` (the submitted jsonb),
`is_correct`, `answered_at`. Response stays `{ is_correct, feedback,
correct_answer }`; `correct_answer` is the reveal — the canonical string for
fill_blank, the option text for mcq, the `{ pairs }` truth for matching (only
returned post-answer, as today).

#### 4. exercises.kind CHECK constraint

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_exercise_kind_check.sql` (new)

**Intent**: Constrain `exercises.kind` to the three known values, mirroring the
`generated_content.kind` convention and the F-01 RLS/template hygiene.

**Contract**: `alter table public.exercises add constraint exercises_kind_check
check (kind in ('mcq','fill_blank','matching'));`. Existing rows are all `'mcq'`,
so the constraint validates cleanly. No column type change → `database.types.ts`
regeneration is a no-op for TS (kind stays `string`); regenerate only if
convenient.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Per-type grading unit tests pass: `npx vitest run src/lib/services/grading.test.ts`
- Existing answer-endpoint integration tests pass (updated for kind branching):
  `npx vitest run src/pages/api/sessions`
- Migration applies cleanly against local Supabase: `npx supabase db reset` (or
  `db push` to the linked project per the F-01 workflow)

#### Manual Verification:

- Submitting a correct/incorrect answer of each type flips `is_correct` correctly
  and the percent score reflects it.
- The matching `options.right` order is stable between page load and grading (no
  reshuffle desync).
- Pre-answer, no network response or page payload exposes a matching item's
  correct mapping.

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Session UI renderers

### Overview

Render fill-blank and matching exercises in the session runner alongside MCQ,
widening the loader and the `ExerciseView` shape. Solutions stay hidden until the
item is answered.

### Changes Required:

#### 1. Loader passes kind + per-type display data

**File**: `src/pages/sessions/[id].astro`

**Intent**: Surface each exercise's `kind` and the display fields the renderers
need, keeping the existing `answered`-gated reveal of `correct_answer`.

**Contract**: Select `kind, options, correct_answer` (already selected) and map
into the widened `ExerciseView`: `mcq` → `options: string[]`; `fill_blank` → no
options; `matching` → `left: string[]`, `right: string[]` (from `options`).
`correct_answer` continues to be exposed **only** when `answered_at !== null`
(for matching, the `{ pairs }` reveal).

#### 2. Type-discriminated ExerciseView + renderers

**File**: `src/components/session/SessionRunner.tsx`

**Intent**: Branch rendering and answer submission on `kind`, reusing the
existing result/feedback display, milestone bar, and navigation.

**Contract**: `ExerciseView` becomes a discriminated union on `kind` carrying the
per-type display fields and the shared `id, position, prompt, feedback,
learner_answer, is_correct, correct_answer`. Generalize the submit handler to
build a per-kind payload (`{ answer: string }` for mcq/fill_blank, `{ answer:
Record<string,string> }` for matching) and POST to the existing endpoint. New
renderers:

- **fill_blank**: a labeled text input + Submit button; disabled once answered;
  reveal shows the canonical correct answer on miss.
- **matching**: one `<select>` per left item listing the shuffled right options
  (`getByLabel`-addressable per CLAUDE.md E2E rules); a Submit button enabled
  once all selects are chosen; on answer, show which pairs were right/wrong using
  the returned `{ pairs }`.

`allAnswered` / "Finish session" gating is unchanged (each exercise still yields
exactly one result entry). The milestone bar's correct/incorrect coloring works
as-is off `result.is_correct`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Full unit suite passes: `npx vitest run`

#### Manual Verification:

- A new session renders all three exercise types, each answerable, with correct
  per-item feedback and a coherent final score.
- Reloading a partially/fully answered session restores answered state for all
  three types (seeded results), and the matching right-column order is stable.
- Keyboard/screen-reader: each matching `<select>` is reachable by its left-item
  label; the fill-blank input has an associated label.

**Implementation Note**: After completing this phase and all automated
verification passes, confirm the full multi-type session works end-to-end.

---

## Testing Strategy

### Unit Tests:

- **Sizing distribution** (`sizing.test.ts`, extend): per-type counts are pure;
  each type and the total are monotonic non-decreasing across 15→30→60; totals
  match the recipe table.
- **Per-type grading** (`grading.test.ts`, new): mcq strict equality;
  fill_blank normalized match incl. casing/whitespace and an `acceptable`
  variant, and rejection of a wrong answer; matching all-or-nothing (all pairs
  right = correct; any wrong pair = incorrect; order-insensitive on left;
  malformed submission = incorrect).

### Integration Tests:

- Update the existing answer-endpoint integration test
  (`[exerciseId].integration.test.ts`) to cover the kind branch + 400 on
  malformed per-kind payloads. Keep `complete.integration.test.ts` green
  (score aggregation across mixed types).

### Manual Testing Steps:

1. Start a 30-minute session on a real file; confirm a 3-mcq / 1-fill / 1-match mix.
2. Answer each type correctly, confirm feedback + milestone coloring.
3. Re-run, answer a matching item with one wrong pair → item marked incorrect.
4. Reload mid-session → answered items restore; matching right order stable.
5. Finish → score equals percent of correct items across all three types.

## Migration Notes

One additive migration: a CHECK constraint on `exercises.kind`. Existing prod
rows are all `'mcq'`, so it validates without data backfill. Follow the F-01
push workflow (transaction pooler). No column changes; jsonb columns absorb the
new `options`/`correct_answer`/`learner_answer` shapes.

## References

- Change identity: `context/changes/multi-type-exercises/change.md`
- Roadmap slice: `context/foundation/roadmap.md` (S-04)
- Generation contract: `src/lib/services/generation/schema.ts`, `generate.ts`
- Sizing: `src/lib/services/generation/sizing.ts`
- Persistence: `src/pages/api/sessions/index.ts:151`
- Grading site: `src/pages/api/sessions/[id]/exercises/[exerciseId].ts:55`
- Score: `src/lib/services/scoring.ts:12`
- UI: `src/components/session/SessionRunner.tsx`
- RLS/migration template: `docs/reference/rls-policy-template.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Generation contract & sizing

#### Automated

- [x] 1.1 Type checking passes: `npm run build` (+ `astro check`: 0 errors)
- [x] 1.2 Linting passes: `npm run lint` (0 errors)
- [x] 1.3 Sizing distribution unit tests pass
- [x] 1.4 Existing generation unit tests pass (updated for the union)

#### Manual

- [x] 1.5 Per-type counts sum to the intended total and are monotonic across budgets

### Phase 2: Persistence, grading & data hardening

#### Automated

- [x] 2.1 Type checking passes: `npm run build` (+ `astro check`: 0 errors)
- [x] 2.2 Linting passes: `npm run lint` (0 errors)
- [x] 2.3 Per-type grading unit tests pass (17 tests)
- [x] 2.4 Answer-endpoint integration tests pass — full integration suite green (23 tests) against local Supabase
- [x] 2.5 Migration applies cleanly against local Supabase (`db reset`: all 6 migrations incl. `20260614000000_exercise_kind_check` applied)

#### Manual

- [x] 2.6 Correct/incorrect answer of each type flips is_correct + score correctly (live drive: mcq/fill/matching → 100; matching one-wrong → false/0)
- [x] 2.7 Matching options.right order stable between load and grading (stored once at write; grading keys off left→right mapping, drive scored correctly)
- [x] 2.8 No pre-answer leak of a matching item's correct mapping (loader returns correct_answer only post-answer; verified mapping appears only in the answered response)

### Phase 3: Session UI renderers

#### Automated

- [x] 3.1 Type checking passes: `npm run build` (+ `astro check`: 0 errors)
- [x] 3.2 Linting passes: `npm run lint` (0 errors)
- [x] 3.3 Full unit suite passes: `npx vitest run` (68 tests)

#### Manual

- [x] 3.4 New session renders all three types, each answerable, coherent score (live drive against running dev server, 14/14 checks)
- [x] 3.5 Reload restores answered state for all three types; matching order stable — live re-drive: post-answer GET restores answered state (feedback + "Correct") for mcq/fill/matching (9/9; impl-review F4)
- [x] 3.6 Matching selects reachable by left-item label; fill-blank input labeled (SSR HTML contains `aria-label="Match for Dog"` and the "Your answer" label)
