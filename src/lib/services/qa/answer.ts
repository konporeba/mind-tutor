// Grounded ask-the-tutor Q&A (S-05, FR-008).
//
// A learner asks a free-form question mid-session; the tutor answers STRICTLY from
// the uploaded source material (the wedge — no off-source claims). Unlike session
// generation (one buffered, schema-validated JSON call), a Q&A answer is free prose
// STREAMED token-by-token (Phase 1 proved SSE works on Cloudflare Workers), so this
// is a parallel path to generateSession, not an extension of it.
//
// Grounding here is prompt-enforced (answer only from source; refuse on-source when
// the source doesn't cover it) rather than citation-checked — a prose answer has no
// structured citations to validate. The offline judge eval (Phase 5) is the guard.

import { E2E_STUB_OPENROUTER } from "astro:env/server";
import { GenerationError, getModel, getOpenRouterClient } from "@/lib/services/generation/openrouter";
import type { ConversationRole } from "@/types";

// Cap the grounding corpus (reuse the generation convention) so a dense session
// stays within model context and bounded cost. Prior turns are bounded too, so a
// long conversation can't blow the token budget.
const MAX_SOURCE_CHARS = 60_000;
/** Most recent turns kept as follow-up context. Exported so the endpoint can bound its
 *  conversation read to the same window instead of loading the whole transcript. */
export const MAX_PRIOR_TURNS = 10;

/** One persisted conversation turn, as fed back into the prompt for follow-ups. */
export interface QaTurn {
  role: ConversationRole;
  content: string;
}

/** Build the messages for a Q&A turn. Pure: same source + prior turns + question
 *  always yield the same messages (exported for the unit test). The source is
 *  embedded in the system frame so the grounding rules and corpus always lead the
 *  conversation; the most recent prior turns supply follow-up context. */
export function buildQaMessages(sourceText: string, priorTurns: QaTurn[], question: string) {
  const source = sourceText.trim().slice(0, MAX_SOURCE_CHARS);

  const system = [
    "You are MindTutor, an AI study tutor answering a learner's questions about their own uploaded study material.",
    "Answer ONLY using facts present in the SOURCE MATERIAL below. Never introduce outside knowledge or invent details.",
    "If the answer is not in the source material, briefly say you cannot find it in their material and invite them to rephrase or ask about something the material covers. Do not answer from general knowledge.",
    "Keep answers concise and directly grounded in the source.",
    "",
    "SOURCE MATERIAL:",
    '"""',
    source,
    '"""',
  ].join("\n");

  // Only the most recent turns are included — older context is dropped to bound tokens.
  const recent = priorTurns.slice(-MAX_PRIOR_TURNS);

  return [
    { role: "system" as const, content: system },
    ...recent.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user" as const, content: question },
  ];
}

/** Deterministic stub answer for E2E_STUB_OPENROUTER (no real, paid call). */
function stubAnswer(question: string): string {
  return `Based on your material: ${question.trim().slice(0, 80)} — deterministic Q&A stub answer.`;
}

/**
 * Stream a grounded answer as text deltas. Yields the canned stub when
 * E2E_STUB_OPENROUTER is set (deterministic E2E), otherwise streams from
 * OpenRouter with `stream: true`. Throws GenerationError if the API call fails.
 * The caller accumulates the yielded deltas to persist the full assistant turn.
 */
export async function* answerQuestion(
  sourceText: string,
  priorTurns: QaTurn[],
  question: string,
): AsyncGenerator<string> {
  if (E2E_STUB_OPENROUTER) {
    yield stubAnswer(question);
    return;
  }

  const client = getOpenRouterClient();
  const model = getModel();
  const messages = buildQaMessages(sourceText, priorTurns, question);

  let stream;
  try {
    stream = await client.chat.completions.create({
      model,
      messages,
      stream: true,
      temperature: 0.3,
      max_tokens: 1000,
    });
  } catch (err) {
    throw new GenerationError(`Q&A request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      yield delta;
    }
  }
}
