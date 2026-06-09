# Onboarding Bio Tailoring (S-03) — Plan Brief

> Full plan: `context/changes/onboarding-bio-tailoring/plan.md`

## What & Why

The first time a learner signs in, a bounded guided-chat onboarding captures their background (role, experience, domains) once and distills it into a free-text **bio** on their profile. Every later session injects that bio into the generation prompt so study content matches the learner's idiom and default depth. This completes **FR-005** and the **bio half of FR-006** (S-02 shipped the per-session half) — both halves of the personalization wedge are now wired.

## Starting Point

S-01 (session loop) and S-02 (per-session intake) are live in prod. There is **no `profiles` table** (F-01 flagged it as S-03's job). Generation already accepts the per-session intake via the pure `buildMessages(source, intake, sizing)`, deliberately shaped by S-02 to accept a bio later. Middleware resolves the user on every request and gates `PROTECTED_ROUTES`. The only LLM usage today is one-shot structured JSON — no chat pattern yet.

## Desired End State

A new learner is force-redirected to `/onboarding`, answers 2–3 short tutor questions, and lands on the dashboard with a stored bio. Thereafter, two sessions on the same file + same intake but different bios produce visibly different prose framing (same step/MCQ counts). Returning learners are never gated; historical null-bio sessions render unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Capture UX | Bounded guided chat (2–3 turns) + one distill LLM call | Honors FR-005's "AI personality starts here" while reusing the existing one-shot OpenRouter pattern | Plan |
| Bio shape | Single free-text `bio` column | Exactly what FR-005 specifies; simplest schema | Plan |
| Onboarding gate | Middleware redirect (forced before gated routes) | Guarantees a bio exists before the first session; one gate covers all entry points | Plan |
| Bio → generation | Prompt-framing only (idiom/depth), NOT sizing counts | Matches FR-006's split; keeps the monotonic sizing test stable | Plan |
| LLM-fail resilience | Store concatenated raw answers as the bio | Forced gate must not lock new learners out on an LLM outage (PRD reliability guardrail) | Plan |
| Null-bio path | Omit the bio block entirely | Backward-compatible with S-01/S-02 sessions; no degenerate prompt line | Plan |
| Re-run/edit scope | One-time; re-prompt only if incomplete; editing is S-08 | Respects the roadmap's S-03→S-08 split | Plan |

## Scope

**In scope:** `profiles` table + RLS; bio in `buildMessages`/`generateSession`; distill service with raw-answer fallback; `POST /api/onboarding`; bio load in `POST /api/sessions`; middleware gate; `/onboarding` page + chat island; Vitest prompt assertions.

**Out of scope:** editing/redoing an existing bio (S-08); structured bio fields; bio affecting counts; full open-ended conversational agent; backfill; `auth.users` triggers.

## Architecture / Approach

Bottom-up, mirroring S-02. `profiles` (PK = `user_id`, F-01 RLS template) → generation reads an optional bio and conditionally injects a framing block → distill service + onboarding API persist the bio (LLM with raw-answers fallback) and session creation loads it by `user_id` → middleware forces `/onboarding` for not-yet-onboarded users → the chat island collects answers → Vitest pins the prompt-level behavior. Bio is resolved **once** before the generation retry loop, exactly like sizing.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema + types | `profiles` table, RLS, regenerated types | RLS isolation correct on a PK-is-`user_id` table |
| 2. Bio in generation | Optional bio injected into `buildMessages`; null omitted | Null path must be byte-identical to S-02 |
| 3. Distill + API wiring | Distill service (raw-answer fallback), `/api/onboarding`, bio load in session POST | LLM-fail path must never hard-block |
| 4. Gate + UI | Middleware redirect + `/onboarding` page + chat island | Redirect-loop safety (exempt onboarding/auth paths) |
| 5. Verification | Vitest bio prompt-level assertions | Assertions must have teeth (catch a regression) |

**Prerequisites:** S-01 + S-02 shipped (done); existing Vitest harness + CI test step (from S-02).
**Estimated effort:** ~2–3 sessions across 5 phases (the new chat island + middleware gate are the only net-new surfaces; everything else extends S-02 patterns).

## Open Risks & Assumptions

- The forced middleware gate adds one `profiles` read per authenticated gated request — assumed negligible at MVP low QPS; cacheable later if not.
- A bounded scripted chat is assumed "conversational enough" to satisfy FR-005's intent; if not, the full-agent option is a documented fast-follow.
- The distill prompt's bio quality is a manual judgment (not unit-testable); the raw-answer fallback guarantees a usable bio either way.

## Success Criteria (Summary)

- A first-time learner cannot reach a session without completing onboarding; the bio persists and is reused.
- Two different bios measurably change the generated prompt (same intake) — proven by Vitest.
- An LLM outage during onboarding never blocks the learner; existing null-bio sessions are unaffected.
