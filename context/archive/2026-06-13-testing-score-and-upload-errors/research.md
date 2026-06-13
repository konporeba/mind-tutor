---
date: 2026-06-13T00:00:00Z
researcher: porebkon
git_commit: 075a83fab43fa5f34486663a794fd1a402de6f2f
branch: master
repository: MindTutor
topic: "Score correctness (Risk #4) + upload/parse error surfacing (Risk #5) — test-plan Phase 3"
tags: [research, codebase, scoring, upload, validation, parse-error, phase-3]
status: complete
last_updated: 2026-06-13
last_updated_by: porebkon
---

# Research: Score correctness + upload/parse error surfacing (test-plan Phase 3)

**Date**: 2026-06-13T00:00:00Z
**Researcher**: porebkon
**Git Commit**: 075a83fab43fa5f34486663a794fd1a402de6f2f
**Branch**: master
**Repository**: MindTutor

## Research Question

Ground rollout Phase 3 of `context/foundation/test-plan.md` ("Score correctness +
upload/parse error surfacing") in current code, for the two risks it covers:

- **Risk #4 — Performance score miscomputed.** Where is the score computed? How does
  per-exercise correctness aggregate into the total, across MCQ and future exercise
  types? What would an *independent* oracle assert (not a value lifted from the code)?
- **Risk #5 — Upload / parse error not surfaced.** What is the upload-validation /
  parse path? Where does a corrupt / oversize / unsupported / empty-extraction input
  get turned into a clean explanatory error, and is that guaranteed to happen *before*
  generation runs?

## Summary

**Risk #4 is concentrated in one pure function and one aggregation call site, with a
clean single-source-of-truth design.** The score is computed exactly once, server-side,
by `computeScore()` in `src/lib/services/scoring.ts:12`, invoked only from
`POST /api/sessions/[id]/complete` (`complete.ts:51`). It is `Math.round(correct/total*100)`
where `correct = count(is_correct === true)`. The function is **kind-agnostic** — it reads
only `is_correct`, so it already aggregates "across MCQ and future exercise types"
correctly; the per-type *correctness determination* (currently MCQ string-equality at
`exercises/[exerciseId].ts:55`) is what a new exercise type would have to supply. The
client never recomputes — `SessionRunner.tsx:91-92` just displays the server's number.
This makes #4 ideal for a **pure unit test with an independently-computed oracle**, plus
an optional DB-backed integration test that proves the answer→aggregate→persist wiring.

**Risk #5 is defended at two layers, and the "before generation runs" guarantee is
structural (ordering), not incidental.** Client-side: `validateFile()`
(`parseFile.ts:18`) rejects unsupported-type / oversize at file-pick time; `parseFile()`
throws on a corrupt/encrypted PDF; `NewSessionForm.submit` (`NewSessionForm.tsx:51-82`)
catches the throw and guards empty extraction *before* it POSTs. Server-side (the
load-bearing, cheaply-testable surface): `POST /api/sessions` re-validates the same four
conditions in four guard clauses (`sessions/index.ts:60-71`) that all `return 400`
**before** the `generateSession(...)` call at `sessions/index.ts:96`. No DB read precedes
those guards (the profile read is at line 90, after them), so the guard slice is testable
without real Supabase. The strongest assertion is: bad input → 400 with the right message
**and `generateSession` is never called** (spy).

## Detailed Findings

### Risk #4 — where the score lives and how it aggregates

**The pure computation — `src/lib/services/scoring.ts:12`**

```ts
export function computeScore(exercises: Pick<Exercise, "is_correct">[]): number {
  const total = exercises.length;
  if (total === 0) return 0;
  const correct = exercises.filter((e) => e.is_correct === true).length;
  return Math.round((correct / total) * 100);
}
```

Contract pinned by the code + its header comment (`scoring.ts:1-11`):
- Percentage of **all** exercises (not just answered) that are correct, 0–100, **rounded**.
- Empty set → `0`.
- `is_correct === null` (unanswered) and `false` both count as **incorrect** — only strict
  `=== true` counts. This is a deliberate product choice, and is exactly the kind of
  contract a test should pin (a fixture with unanswered rows).
- Input type is `Pick<Exercise, "is_correct">[]` — **kind-agnostic**: it never inspects
  `kind`, so MCQ and any future exercise type aggregate identically as long as the row
  carries `is_correct`.

**Aggregation call site — `src/pages/api/sessions/[id]/complete.ts:42-62`**

`POST .../complete` loads every exercise row's `is_correct` for the session
(`.select("is_correct").eq("session_id", sessionId)`, line 42-45), calls `computeScore`
(line 51), writes `score` + `status:"completed"` + `completed_at` to the session
(line 53-56), and returns `{ score }` (line 62). Idempotent (re-running recomputes from
the same persisted rows). Ownership is RLS-scoped via the `.single()` existence check at
line 36 (the Phase 2 isolation surface — already tested).

**Per-exercise correctness — `src/pages/api/sessions/[id]/exercises/[exerciseId].ts:55`**

`is_correct` is set when the learner answers: `isCorrect = exercise.correct_answer === parsed.answer`
(strict string equality), persisted at line 57-65. This is the **only** place correctness
is determined, and it is MCQ-specific (compares the chosen option string to the stored
correct option). `correct_answer` is stored in `sessions/index.ts:158` as
`mcq.options[mcq.correctIndex]` (a string).

**No divergent computation anywhere.** A `grep` for `computeScore|is_correct|score|correct_answer`
across `src/**` confirms: the only producer of `score` is `complete.ts`; `SessionRunner.tsx`
(`:59`, `:91-92`, `:153`) only *consumes* the server value (`setScore(data.score)`,
renders `{score}%`). `sessions/[id].astro:71` passes the persisted `session.score` as
`initialScore`. There is no second, client-side, drift-prone score path.

**Independent oracle for the unit test** (avoids the §2 oracle anti-pattern — do **not**
copy expected values out of `computeScore`): build the percentage by hand from a
known-answer fixture, e.g.
- `[]` → `0` (empty)
- 3× true → `100`
- 1 true / 3 total → `33` (Math.round(33.33)); 2 true / 3 → `67`
- 2 true / 1 false / 2 null (unanswered), 5 total → `40` (pins "null counts as incorrect")
- a half-rounding case, e.g. 1 true / 8 → `13` (Math.round(12.5) → 13) to pin rounding
- a **mixed-kind** fixture (`kind:"mcq"` + a synthetic future kind) to prove kind-agnostic aggregation

`Math.round` rounds .5 toward +∞ — worth one fixture row so the rounding rule is asserted,
not assumed.

### Risk #5 — the upload/validation/parse path, end to end

**Client layer 1 — type/size gate at pick time. `src/components/session/lib/parseFile.ts`**

- `MAX_SIZE_BYTES = 20 * 1024 * 1024` (`:9`), `ALLOWED_EXTENSIONS = ["pdf","txt","md"]` (`:10`).
- `extensionOf(filename)` (`:12`) — lowercased substring after the last `.`; `""` if no dot.
- `validateFile(file)` (`:18`) — returns an explanatory message or `null`:
  - unsupported extension → `"Unsupported file type. Upload a PDF, .txt, or .md file."`
  - oversize → `"File exceeds the 20 MB limit."`
- Called from `NewSessionForm.pickFile` (`NewSessionForm.tsx:32`) the moment a file is chosen.
- **These two functions are pure and import-safe**: the only top-level import is
  `import type { TextItem }` (type-only, erased at compile). pdf.js is loaded lazily inside
  `parsePdf` (`:35`, dynamic `import()`), per the `lessons.md` SSR rule — so a `node`-env
  unit test importing `validateFile`/`extensionOf` needs **no mocks and no jsdom**.

**Client layer 2 — extraction + throw/empty handling. `parseFile.ts:60` + `NewSessionForm.tsx:51-82`**

- `parseFile(file)` (`:60`): PDF → `parsePdf` (can **throw** on corrupt/encrypted); txt/md →
  `file.text()`, both `.trim()`ed. The header comment (`:56-59`) documents the throw contract.
- `submit()` (`NewSessionForm.tsx:51`): sets `status:"reading"`, awaits `parseFile`, then guards
  **empty extraction** before any network call: `if (!extractedText.trim())` → `status:"error"` +
  `"Couldn't read any text from this file. Try another file."` (`:54-58`). The surrounding
  `try/catch` (`:78-81`) turns a `parseFile` throw into
  `"Couldn't read this file. It may be corrupted or password-protected."` Only after a non-empty
  extraction does it POST to `/api/sessions` (`:68`).
- **Caveat for testability:** this is React state logic with no Testing Library / jsdom in the
  stack (Vitest env is `node`, §4). The client empty/corrupt *surfacing* is therefore not
  cheaply unit-testable; its cost×signal-cheap equivalent is the **server** re-validation below.

**Server layer — the load-bearing, cheaply-testable surface. `src/pages/api/sessions/index.ts`**

Defense-in-depth re-validation, four guard clauses, all returning a clean `400` JSON
**before** generation (`sessions/index.ts:60-71`):
- `!(file instanceof File)` → `400 "No file provided"` (`:60`)
- `extractedText` empty / not a string → `400 "Could not read any text from the file"` (`:63`)
  — this is exactly the §2 "Empty extracted text means no content, so proceed" challenge.
- unsupported extension → `400 "Unsupported file type. Upload a PDF, .txt, or .md file."` (`:66`)
- `file.size > MAX_SIZE_BYTES` → `400 "File exceeds the 20 MB limit."` (`:69`)

**Ordering proves "before generation runs":** auth (`:45`) → `createClient` (`:50`) → `formData()`
(`:56`) → the four bad-input guards (`:60-71`) → intake `safeParse` (`:74`) → profile read (`:90`,
first DB read) → `generateSession(...)` (`:96`). The bad-input guards precede both the first DB
read and generation, so a test of this slice needs **no real Supabase and no real OpenRouter** —
mock `@/lib/supabase`'s `createClient` to a dummy non-null object and spy/mock
`generateSession`; assert `400` + message **and** that `generateSession` was never invoked.

A `GenerationError` thrown by `generateSession` itself is already mapped to `502
"Could not generate a session from this material. Please try again."` (`:98-101`) — that is
**Risk #2 / Phase 1 territory** (already covered by `generate.session.test.ts`), not #5. #5 stops
at the pre-generation guards.

**What "corrupt" reduces to at each layer:** a corrupt/encrypted PDF surfaces *client-side* as a
`parseFile` throw (→ catch message). The server never sees raw corruption — it receives
`extractedText`; a corrupt file that yielded no text arrives as empty `extractedText` → the
line-63 guard. So server-side, "corrupt" and "empty-extraction" are the same code path.

## Code References

- `src/lib/services/scoring.ts:12-19` — `computeScore`: the entire #4 computation (pure)
- `src/pages/api/sessions/[id]/complete.ts:42-62` — loads `is_correct` rows, aggregates, persists `score`
- `src/pages/api/sessions/[id]/exercises/[exerciseId].ts:55-65` — per-exercise correctness (MCQ string-equality) sets `is_correct`
- `src/components/session/SessionRunner.tsx:91-92,153` — client *displays* server score; no recomputation
- `src/components/session/lib/parseFile.ts:9-26` — `MAX_SIZE_BYTES`, `ALLOWED_EXTENSIONS`, `extensionOf`, `validateFile` (pure, import-safe)
- `src/components/session/lib/parseFile.ts:60-65` — `parseFile` (throws on corrupt PDF)
- `src/components/session/NewSessionForm.tsx:51-82` — client extract / empty-guard / catch→message / POST
- `src/pages/api/sessions/index.ts:60-71` — server bad-input guards (the four 400s)
- `src/pages/api/sessions/index.ts:90,96` — first DB read / generation call (both after the guards)
- `src/lib/services/generation/schema.ts:30-47` — `McqSchema` (`correctIndex`), `GeneratedSessionSchema`
- `src/types.ts:22` — `Exercise` row type (source of `Pick<Exercise,"is_correct">`)

## Architecture Insights

- **Single source of truth for the score.** One pure function, one call site, server-authoritative,
  client display-only. This is why #4's cheapest real signal is a pure unit test on `computeScore`
  with a hand-computed oracle; the integration layer adds *wiring* signal (answer endpoint sets
  `is_correct` → complete aggregates → persists), not *math* signal.
- **Score aggregation is already future-type-ready; correctness determination is not.** `computeScore`
  is kind-blind. A future exercise kind only needs to populate `is_correct` (via its own endpoint
  logic, analogous to the MCQ string-equality at `exercises/[exerciseId].ts:55`) and it aggregates
  for free. A fixture mixing `kind` values proves this property cheaply.
- **"Before generation" is an ordering invariant.** The four guards sit ahead of the first DB read
  and `generateSession`. A spy-on-`generateSession`/assert-not-called is the precise way to pin that
  invariant — it would fail if a future refactor reordered validation after generation.
- **Two validation layers intentionally duplicate** (client form gate + server re-validate; comment
  "defense-in-depth" at `sessions/index.ts:23,55`). The server is the trust boundary and the
  cheap-to-test one (`node` env, no DB before the guards); the client form is UI not cheaply reachable
  without adding jsdom/RTL — note in §7 negative-space, not a gap to force-fit.
- **`MAX_SIZE_BYTES`/`ALLOWED_EXTENSIONS` are duplicated** between `parseFile.ts:9-10` and
  `sessions/index.ts:20-21` (not shared). A test asserting both layers reject a 21 MB / `.docx` input
  protects against the two copies drifting apart.

## Candidate test layers (input to /10x-plan — not a plan)

Per §1 cost×signal and the §2 Risk-Response "cheapest layer" column:

- **#4 core — pure unit** on `computeScore` (`scoring.test.ts` beside the module, §6.1 pattern), with
  an **independently-computed** oracle fixture: empty→0, all-correct→100, the 33/67 rounding pair, a
  half-round case, an unanswered-null case, and a mixed-`kind` case. No mocks. Cheapest, highest signal.
- **#4 wiring — DB-backed integration** (`*.integration.test.ts`, §6.3 harness) only if the unit leaves
  a real gap: seed N exercises with known `correct_answer`s, submit a known mix of right/wrong/unanswered
  via the real `exercises/[exerciseId]` POST, call the real `complete` POST, assert persisted `score`
  equals the independent percent. NOTE: `createSessionGraph` (`factories.ts:30`) seeds **one** MCQ —
  this layer needs multiple exercises, so the factory must be extended or extra rows inserted.
- **#5 client-pure — unit** on `validateFile`/`extensionOf` (`parseFile.test.ts`, §6.1, no mocks):
  unsupported type, oversize, each allowed type → `null`, and extension edge cases (no dot, uppercase
  `.PDF`, dotfile `.gitignore`, double extension `notes.pdf.exe` / `archive.tar.gz`).
- **#5 server guard — route-level test** on `POST /api/sessions` (default `npm test`, mock
  `@/lib/supabase` `createClient`, spy `generateSession`): each of the four bad inputs → `400` + the
  right message **and** `generateSession` not called. Pins the "before generation" invariant. The
  empty-`extractedText` case is the §2 must-challenge ("empty means no content, so proceed").
- **Cookbook:** fill §6.4 (score/aggregation pattern) and §6.5 (upload/parse error-path pattern), and
  append a §6.7 note for Phase 3.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md` §2 Risk-Response rows for #4 and #5 — the "what would prove
  protection", "must challenge", and "anti-pattern to avoid" (oracle problem for #4; "assert silent
  pass-through of empty content" for #5) that this phase must honor.
- `context/archive/2026-06-10-testing-cross-learner-isolation/` (Phase 2) — bootstrapped the DB-backed
  integration harness (`src/test/integration/`, `vitest.integration.config.ts`,
  `npm run test:integration`) and the `createSessionGraph` factory this phase's #4 integration test
  would reuse/extend. Its `complete.integration.test.ts` already exercises the `complete` route's 404
  path (Risk #3) and its owner-200 control asserts `typeof body.score === "number"` — adjacent to, but
  not asserting, #4 correctness.
- `context/changes/testing-generation-pipeline-contract/` (Phase 1) — owns the `GenerationError`→502
  failure-mode coverage (`generate.session.test.ts`); #5 deliberately stops at the *pre*-generation
  guards so it does not overlap.
- `context/foundation/lessons.md` — "Lazy-import browser-only libraries in SSR'd islands": confirms why
  `parseFile.ts`'s pure functions are import-safe for a `node`-env unit test (pdf.js is dynamically
  imported inside `parsePdf` only).

## Related Research

- `context/archive/2026-06-10-testing-cross-learner-isolation/research.md` — prior exploration of the
  session API ownership/RLS surface (the `complete` and `exercises` endpoints this phase also touches).

## Open Questions

- **Client-form surfacing (empty/corrupt) coverage.** Cheap server re-validation covers the trust
  boundary; the React form's own empty-guard + corrupt-catch (`NewSessionForm.tsx:54-81`) is not
  cheaply testable without adding jsdom/RTL (not in the stack). Decision for /10x-plan: pin it at the
  server layer and record the client surfacing in §7 negative-space, vs. introduce jsdom now. Recommend
  the former (cost×signal).
- **#4 unit vs. integration split.** Does the pure-unit oracle on `computeScore` make the DB-backed
  end-to-end score integration redundant, or is the answer→aggregate→persist wiring worth the extra
  cost (plus a `createSessionGraph` multi-exercise extension)? /10x-plan to weigh.
- **Duplicated limits.** Should `MAX_SIZE_BYTES`/`ALLOWED_EXTENSIONS` be de-duplicated (shared module)
  rather than copied in `parseFile.ts` and `sessions/index.ts`? Out of scope for a test phase, but a
  test asserting both layers guards against drift in the meantime.
