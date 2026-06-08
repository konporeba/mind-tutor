# Per-Session Intake Tailoring (S-02) — Plan Brief

> Full plan: `context/changes/per-session-intake-tailoring/plan.md`

## What & Why

At the start of every new session, capture a brief intake — knowledge level for the uploaded material, learning goal, and available time — and use it to **measurably bias** the generated theory and exercise depth/pacing. This is the per-session half of FR-006: tailoring the wedge to the learner's actual situation this sitting, which is the core market-feedback signal S-02 exists to test.

## Starting Point

The S-01 loop is live: upload → parse (browser) → `POST /api/sessions` → `generateSession(sourceText)` → persist → score. Generation depends only on source text, with hard-coded counts (theory 3–5, MCQ 5); `schema.ts` even marks "intake-driven sizing is S-02." The `sessions` table has no intake columns, and the repo has no JS test runner.

## Desired End State

`/sessions/new` requires a knowledge level, a goal, and a time budget before generating. Those values persist on the session and visibly shape output — a 15-min novice session is shorter/shallower than a 60-min advanced one, and the goal steers focus. A committed Vitest test proves intake reaches the prompt and changes sizing.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Intake UX | Structured 3-field form | Fastest path to market feedback; conscious divergence from FR-018's conversational intake (fast-follow) | Plan |
| Knowledge level | 5-point scale (novice→expert) | Typed enum drives depth calibration + a DB check constraint | Plan |
| Learning goal | Short free text (≤280) | Captures authentic per-sitting intent, injected to focus content | Plan |
| Available time | Buckets (~15/~30/~60 min) | Maps cleanly to deterministic session sizing | Plan |
| Storage | Typed columns on `sessions` | Queryable, typed, reuses F-01 RLS as-is | Plan |
| Tailoring | Prompt injection + dynamic sizing | Satisfies FR-006 (prompt-level) AND produces visibly different sessions | Plan |
| Verification | Deterministic Vitest unit test | Pure prompt-builder + sizing map → CI-runnable proof; resolves S-02's open unknown | Plan |
| Intake required | All three required | Matches FR-018 ("every session begins with intake") | Plan |

## Scope

**In scope:** intake columns on `sessions`; a pure sizing-map module; intake-aware `generateSession`; API validation + persistence; 3-field form on the new-session page; Vitest harness + tailoring tests; CI test step.

**Out of scope:** conversational intake (FR-018 fast-follow); profile bio / FR-005 / bio half of FR-006 (S-03); mid-session edits (PRD non-goal); backfill of historical sessions; model-output-quality assertions.

## Architecture / Approach

Bottom-up around one source of truth. `sizing.ts` (`intake → {theory bounds, mcq count, depthGuidance}`) is imported by both generation (to build the prompt and a dynamic zod schema) and the test (to assert variation). Flow delta: the new-session form gains three required fields → POSTed with the existing upload → API validates + persists them on `sessions` and passes a `SessionIntake` into `generateSession(sourceText, intake)`, which sizes once before the retry loop so prompt and validation agree.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & foundation | Intake columns + types + pure sizing map | Migration nullability for existing rows |
| 2. Generation tailoring | Intake-aware prompt + dynamic-bounds schema | Prompt/schema must agree across retries |
| 3. API wiring | Validate + persist intake, feed to generation | All-three-required server validation |
| 4. Intake UI | 3 required fields gated before submit | Submit-gating UX |
| 5. Verification (Vitest) | First JS test runner + tailoring tests + CI step | Path-alias setup; assertions with teeth |

**Prerequisites:** S-01 (done). Local Supabase for migration/types; prod `db push` before code deploy.
**Estimated effort:** ~2–3 sessions across 5 phases.

## Open Risks & Assumptions

- Structured form diverges from FR-018's conversational intent — accepted as MVP scoping; revisit if feedback demands conversational probing.
- Sizing thresholds are heuristic; the test pins monotonicity/variation, not pedagogical optimality.
- Bio (S-03) is absent — `generateSession` is shaped to add it later without a signature break.

## Success Criteria (Summary)

- A learner cannot start a session without providing level, goal, and time; all three persist on the session.
- The same source produces a visibly different-sized session across time/level combinations.
- `npm run test` (new) proves intake reaches the prompt and shifts sizing; build, lint, and pgTAP stay green.
