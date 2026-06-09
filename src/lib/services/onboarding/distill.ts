// Bio distill service (S-03).
//
// Turns a learner's short onboarding answers into a single clean free-text bio
// via one OpenRouter call (reusing the S-01 client). Resilience is the contract:
// the onboarding gate forces every new learner through this path, so an LLM
// outage must never lock them out. On ANY failure we fall back to persisting the
// learner's own concatenated answers as the bio — the flow always completes.

import { BIO_MAX } from "@/types";
import { getModel, getOpenRouterClient } from "../generation/openrouter";

/** Normalize the answers (array or keyed record) into a clean list of non-empty,
 *  trimmed strings — the shared input both the prompt and the fallback consume. */
function normalizeAnswers(answers: string[] | Record<string, string>): string[] {
  const values = Array.isArray(answers) ? answers : Object.values(answers);
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

/** Concatenate raw answers into a single capped string — the deterministic
 *  fallback bio used whenever the distill call cannot produce one. */
function rawAnswersBio(answers: string[] | Record<string, string>): string {
  return normalizeAnswers(answers).join(" ").slice(0, BIO_MAX).trim();
}

/** Build the system/user messages for the distill call. Pure: the same answers
 *  always yield the same messages (exported for testing/inspection). */
export function buildDistillMessages(answers: string[] | Record<string, string>) {
  const cleaned = normalizeAnswers(answers);

  const system = [
    "You write a concise learner background profile for an AI study tutor.",
    "Given a learner's short self-description answers, synthesize a single third-person bio.",
    "Capture their current role, experience level, and the domains/topics they already know.",
    "Use ONLY what the answers state — never invent roles, seniority, or domains.",
    `Keep it under ${BIO_MAX} characters, a few plain sentences, no headings or lists.`,
    "Respond with the bio text only — no preamble, labels, or quotation marks.",
  ].join("\n");

  const user = `LEARNER ANSWERS:\n${cleaned.map((a, i) => `${i + 1}. ${a}`).join("\n")}`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

/**
 * Distill the onboarding answers into a free-text bio. Returns the trimmed model
 * text on success; on ANY error (config, API, empty response) returns the
 * concatenated raw answers (trimmed, capped at BIO_MAX) instead of throwing.
 * Never throws — the onboarding flow depends on this always producing a bio.
 */
export async function distillBio(answers: string[] | Record<string, string>): Promise<string> {
  const fallback = rawAnswersBio(answers);
  try {
    const client = getOpenRouterClient();
    const model = getModel();
    const completion = await client.chat.completions.create({
      model,
      messages: buildDistillMessages(answers),
      temperature: 0.3,
      max_tokens: 500,
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      return fallback;
    }
    return text.slice(0, BIO_MAX).trim();
  } catch (err) {
    console.error("[onboarding/distill] falling back to raw answers:", err instanceof Error ? err.message : err);
    return fallback;
  }
}
