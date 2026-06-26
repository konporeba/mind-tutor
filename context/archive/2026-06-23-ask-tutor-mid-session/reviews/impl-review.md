<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Ask the Tutor Mid-Session (S-05)

- **Plan**: context/changes/ask-tutor-mid-session/plan.md
- **Scope**: Full plan (Phases 1–5)
- **Date**: 2026-06-26
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Success criteria all green on the merged tree: lint (0 errors), build, unit 81, integration 28, RLS isolation 39, live grounding eval 7.

## Findings

### F1 — Concurrent asks collide on conversation position

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability/data integrity)
- **Location**: src/pages/api/sessions/[id]/ask.ts:100,107,128 + migration:20
- **Detail**: position = priorTurns.length (user) / +1 (assistant), and the table has no unique(session_id, position). Two concurrent asks write duplicate positions → nondeterministic replay order. Client guards with a `streaming` flag, but the server shouldn't rely on it.
- **Fix A ⭐ Recommended**: Add `unique (session_id, position)` to conversation_messages.
  - Strength: DB-enforced integrity; second concurrent insert fails cleanly (and F2's handling surfaces it). Cheap additive migration.
  - Tradeoff: New migration + regen types; a colliding ask errors.
  - Confidence: HIGH — standard constraint, matches table intent.
  - Blind spot: None significant.
- **Fix B**: Derive position from max(position)+1 server-side.
  - Strength: No client-visible error on collision.
  - Tradeoff: Still racy without the constraint; doesn't close the window.
  - Confidence: MED.
  - Blind spot: Concurrent max() reads under load.
- **Decision**: FIXED via Fix A — migration 20260626000000_conversation_messages_position_unique.sql; isolation test green.

### F2 — Assistant-turn insert error is silently swallowed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/pages/api/sessions/[id]/ask.ts:123-131
- **Detail**: The assistant-turn insert inside ReadableStream.start has no error check. On failure the answer was already streamed/shown but no row persists → on reload the question looks unanswered. No server-side log (the sibling loadConversation logs its errors).
- **Fix**: Capture the insert error and console.error it (match loadConversation); optionally emit a non-fatal warning frame.
- **Decision**: FIXED — error captured + console.error (ask.ts); warning frame emitted and surfaced in AskTutorPanel.

### F3 — Live ask panel suppressed on completed sessions (plan drift)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/session/SessionRunner.tsx:535
- **Detail**: Panel gated `initialStatus !== "completed"`, introduced by parallel S-06 work so its read-only ConversationLog owns the completed view. Plan's Desired End State says usable "after scoring" (plan:42, Phase 4:313). Functionally clean (no dup), but diverges from S-05 intent; manual 4.3 was confirmed when the panel was unconditional.
- **Fix A ⭐ Recommended**: Accept the S-06 reconciliation; record as a plan addendum.
  - Strength: Removes the dup conversation surface on completed sessions; S-06 owns the completed view. Lowest churn.
  - Tradeoff: Can't ask on a completed session; diverges from written plan (record it).
  - Confidence: HIGH — coherent S-05/S-06 boundary.
  - Blind spot: Whether you want Q&A available post-completion.
- **Fix B**: Restore the panel on completed sessions (drop the gate).
  - Strength: Honors original "available after scoring" intent.
  - Tradeoff: Re-introduces two conversation surfaces; touches S-06 territory.
  - Confidence: MED.
  - Blind spot: Whether asking post-completion fits the product model.
- **Decision**: FIXED via Fix A — accepted S-06 reconciliation; recorded as a plan addendum (2026-06-26).

### F4 — Prior-turn DB read is unbounded

- **Severity**: ◾ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (performance)
- **Location**: src/pages/api/sessions/[id]/ask.ts:91
- **Detail**: The endpoint loads ALL prior turns to compute position and feed the prompt, but the prompt only uses the last 10. For a long session this is a growing single-query read.
- **Fix**: Bound the select and compute next position via max(position)+1 rather than fetching every row.
- **Decision**: FIXED — read bounded to last MAX_PRIOR_TURNS (newest-first + reversed); position derived from max+1.

### F5 — Two consistency nits vs sibling patterns

- **Severity**: ◾ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/qa/answer.ts:96-101; src/pages/api/sessions/[id]/ask.ts:69
- **Detail**: (a) The mid-stream for-await loop isn't wrapped in GenerationError like the rest of the service (behavior still correct — caught by route). (b) Reads rely on RLS without the explicit `.eq("user_id", …)` the exercises sibling uses (safe under RLS).
- **Fix**: Optionally wrap the stream loop in GenerationError; leave the .eq as-is (RLS is the gate) or add for symmetry.
- **Decision**: SKIPPED — both are safe and behavior-correct; consistency-only, not worth the churn.
