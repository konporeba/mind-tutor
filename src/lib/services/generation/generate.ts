// Grounded session generation (S-01).
//
// One structured OpenRouter call turns the uploaded source text into a small
// sequenced session: 3-5 cited theory steps + 5 MCQs. The wedge is grounding —
// every theory step must quote the source, and we VALIDATE that quote actually
// occurs in the source text. OpenRouter JSON is not schema-strict, so the
// response is parsed, zod-validated, and citation-checked; any failure retries
// the call once before throwing GenerationError.

import { GeneratedSessionSchema, MCQ_COUNT, THEORY_MAX, THEORY_MIN, type GeneratedSession } from "./schema";
import { GenerationError, getModel, getOpenRouterClient } from "./openrouter";

// Cap how much source we send so we stay within model context and bounded cost.
// Citations are validated against exactly the text we send (the truncated slice).
const MAX_SOURCE_CHARS = 60_000;
const MAX_ATTEMPTS = 2;

/** Collapse all runs of whitespace to a single space and trim, so a citation
 *  that differs from the source only in line breaks / spacing still matches. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildMessages(sourceText: string) {
  const system = [
    "You are MindTutor, an AI study tutor.",
    "You generate a short, guided study session STRICTLY from the provided source material.",
    "Use ONLY facts present in the source. Never introduce outside knowledge or invent details.",
    "Every theory step MUST include a `citation`: a short verbatim quote copied exactly from the source that supports that step.",
    "Respond with a single JSON object and nothing else, matching this shape:",
    "{",
    '  "title": string,',
    `  "theory": Array<{ "position": number, "heading": string, "body": string, "citation": string }> (between ${THEORY_MIN} and ${THEORY_MAX} items, positions starting at 0),`,
    `  "exercises": Array<{ "position": number, "prompt": string, "options": string[] (3-5), "correctIndex": number, "feedback": string }> (exactly ${MCQ_COUNT} multiple-choice items, positions starting at 0)`,
    "}",
    "Each citation must be a substring that appears verbatim in the source text.",
  ].join("\n");

  const user = `SOURCE MATERIAL:\n"""\n${sourceText}\n"""`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

/** Validate that every theory citation occurs verbatim (whitespace-normalized)
 *  in the source we sent. Returns the offending citation, or null if all pass. */
function findUngroundedCitation(session: GeneratedSession, sourceText: string): string | null {
  const haystack = normalizeWhitespace(sourceText).toLowerCase();
  for (const step of session.theory) {
    const needle = normalizeWhitespace(step.citation).toLowerCase();
    if (!haystack.includes(needle)) {
      return step.citation;
    }
  }
  return null;
}

/**
 * Generate a grounded session from already-extracted source text.
 * Throws GenerationError on misconfiguration, API failure, or output that cannot
 * be validated/grounded after one retry.
 */
export async function generateSession(sourceText: string): Promise<GeneratedSession> {
  const trimmed = sourceText.trim();
  if (trimmed.length === 0) {
    throw new GenerationError("Source material is empty; nothing to generate from");
  }
  const source = trimmed.slice(0, MAX_SOURCE_CHARS);

  const client = getOpenRouterClient();
  const model = getModel();
  const messages = buildMessages(source);

  let lastReason = "unknown error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: string | null | undefined;
    try {
      const completion = await client.chat.completions.create({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 4000,
      });
      raw = completion.choices[0]?.message?.content;
    } catch (err) {
      lastReason = `API call failed: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }

    if (!raw) {
      lastReason = "model returned an empty response";
      continue;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      lastReason = "model response was not valid JSON";
      continue;
    }

    const result = GeneratedSessionSchema.safeParse(parsedJson);
    if (!result.success) {
      lastReason = `response failed schema validation: ${result.error.issues[0]?.message ?? "unknown"}`;
      continue;
    }

    const ungrounded = findUngroundedCitation(result.data, source);
    if (ungrounded) {
      lastReason = `citation not found in source: "${ungrounded.slice(0, 60)}…"`;
      continue;
    }

    return result.data;
  }

  throw new GenerationError(`Generation failed after ${MAX_ATTEMPTS} attempts: ${lastReason}`);
}
