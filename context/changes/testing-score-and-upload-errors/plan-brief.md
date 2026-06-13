# Score Correctness + Upload/Parse Error Surfacing (test-plan Phase 3) — Plan Brief

> Full plan: `context/changes/testing-score-and-upload-errors/plan.md`
> Research: `context/changes/testing-score-and-upload-errors/research.md`

## What & Why

Rollout Phase 3 of the project's test plan. Add tests that prove two risks are defended at
the cheapest layer with real signal: **#4 the performance score equals an independently-computed
percentage correct** (not just "a number is present"), and **#5 a bad upload — unsupported,
oversize, corrupt, or empty-extraction — yields a clean explanatory error before generation
runs** (not a silent break or opaque error).

## Starting Point

The score is a single pure function (`computeScore`, `scoring.ts:12`) — kind-agnostic, one
call site, client display-only. Upload validation is defended at two layers: pure, import-safe
client functions (`validateFile`/`extensionOf`) and four server guard clauses in
`POST /api/sessions` (`index.ts:60-71`) that all return `400` before any DB read or
`generateSession`. Vitest is wired (`node` env, `npm test`); only two pure unit tests exist
today. Cookbook §6.4/§6.5 are still "TBD".

## Desired End State

Three new offline tests run under `npm test`: a `computeScore` oracle unit, a `validateFile`
unit, and a server route-guard test asserting each bad input → `400` + message **and**
`generateSession` is never called. The cookbook (§6.4/§6.5), §6.7 note, §7 negative-space, and
the §3 Phase 3 row (→ `complete`) are all updated.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| #4 test layers | Pure unit only (no DB integration) | The score is one pure function; the unit fully pins the math, and Phase 2 already touches the wiring. | Plan |
| #5 client-form surfacing | Cover server layer; record client form in §7 | Server is the trust boundary and node-testable; adding jsdom/RTL for one form isn't worth it. | Plan |
| Duplicated limits | Assert 21 MB / `.docx` at both layers | Cheaply guards the two copied constants against drift without a production refactor. | Plan |
| Scope floor | Both oracle units + server guards | Proves both risks' core protection; only the optional DB integration is deferred. | Plan |
| Cookbook | Dedicated final doc sub-phase | Matches the Module-3 rule that each phase ends by updating the relevant §6 entry. | Plan |

## Scope

**In scope:** `scoring.test.ts` (oracle); `parseFile.test.ts` (client gate + extension edges);
`sessions/index.test.ts` (four server guards, spy-not-called); cookbook §6.4/§6.5/§6.7, §7
negative-space, §3 status flip.

**Out of scope:** DB-backed #4 integration; jsdom/RTL for the React form; de-duplicating the
limit constants; e2e; AI-native judge (Phase 4); CI YAML.

## Architecture / Approach

Three discrete phases. Phase 1 (#4) and Phase 2 (#5) add fast, offline, `node`-env tests under
default `npm test` — no DB, no network, no jsdom. The one non-obvious assertion is in the
Phase 2 route test: spy on `generateSession` and assert it is never called, pinning the
"validation before generation" ordering invariant. Phase 3 makes the cookbook canonical and
closes the rollout row.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Score correctness unit (#4) | `scoring.test.ts` with a hand-computed oracle (incl. rounding, null, mixed-kind) | Lifting expected values from the code (oracle anti-pattern) |
| 2. Upload/parse error surfacing (#5) | `parseFile.test.ts` + `sessions/index.test.ts` (four `400` guards, spy-not-called) | Guard ordering — each fixture must satisfy earlier guards |
| 3. Cookbook & plan docs | §6.4/§6.5 filled, §6.7 note, §7 entry, §3 row → `complete` | Leaving doc work half-done |

**Prerequisites:** none beyond the existing Vitest setup (`npm test`); no `npx supabase start`
needed (default suite is Supabase-free).
**Estimated effort:** ~1 session across 3 phases (test base is small; research is complete).

## Open Risks & Assumptions

- The Phase 2 route test relies on faking the `APIRoute` context (`Request` + real `FormData`,
  `locals.user`) and mocking two seams (`createClient` non-null, `generateSession` spy); if the
  route's early-return shape changes, the fakes need updating.
- Indirect coverage of the score *wiring* (answer→aggregate→persist) leans on Phase 2's
  existing owner-200 integration control; if that's removed, the wiring would be untested.

## Success Criteria (Summary)

- `npm test` runs all three new files green; lint + typecheck pass.
- A bad upload provably returns `400` + the right message **and** never reaches generation.
- The score provably equals an independently re-derived percent across MCQ and a future kind.
- `test-plan.md` §6.4/§6.5 are canonical and the §3 Phase 3 row reads `complete`.
