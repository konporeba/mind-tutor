// Grounded session generation (S-01).
//
// One structured OpenRouter call turns the uploaded source text into a small
// sequenced session: 3-5 cited theory steps + 5 MCQs. The wedge is grounding —
// every theory step must quote the source, and we VALIDATE that quote actually
// occurs in the source text. OpenRouter JSON is not schema-strict, so the
// response is parsed, zod-validated, and citation-checked; any failure retries
// the call once before throwing GenerationError.

import type { SessionIntake } from "@/types";
import { makeGeneratedSessionSchema, type GeneratedSession } from "./schema";
import { GenerationError, getModel, getOpenRouterClient } from "./openrouter";
import { sizeFromIntake, type SessionSizing } from "./sizing";

// Cap how much source we send so we stay within model context and bounded cost.
// Citations are validated against exactly the text we send (the truncated slice).
const MAX_SOURCE_CHARS = 60_000;
const MAX_ATTEMPTS = 2;

/** Collapse all runs of whitespace to a single space and trim, so a citation
 *  that differs from the source only in line breaks / spacing still matches. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Build the system/user messages for a generation call. Pure: the same source +
 *  intake + sizing + bio always yield the same messages (exported for the Phase 5
 *  test). Source-grounding rules from S-01 stay authoritative; intake tailors depth,
 *  focus, and counts; the optional profile bio (S-03) adds long-term idiom/framing
 *  only — when absent, the bio line is omitted entirely (prompt is unchanged). */
export function buildMessages(sourceText: string, intake: SessionIntake, sizing: SessionSizing, bio?: string | null) {
  // Per-learner tailoring block. The bio line is appended only when a bio exists,
  // so a null/empty bio leaves the prompt byte-identical to the S-02 output.
  const tailoring = [
    "Tailor the session to this learner without ever breaking the grounding rules above:",
    `- Knowledge level: ${intake.knowledgeLevel}. ${sizing.depthGuidance}`,
    `- Learning goal: "${intake.learningGoal.trim()}". Keep the theory and exercises focused on this goal where the source supports it.`,
    `- Available time: about ${intake.timeBudgetMinutes} minutes. Size the session to fit this budget.`,
  ];

  const trimmedBio = bio?.trim().replace(/\.+$/, "");
  if (trimmedBio) {
    tailoring.push(
      `- Learner background: ${trimmedBio}. Use this to set the idiom, examples, and default depth of explanation, and to gauge what the learner already finds familiar. This shapes tone and framing only — it does NOT override the knowledge level, learning goal, time budget, or the theory/exercise counts above.`,
    );
  }

  const system = [
    "You are MindTutor, an AI study tutor.",
    "You generate a short, guided study session STRICTLY from the provided source material.",
    "Use ONLY facts present in the source. Never introduce outside knowledge or invent details.",
    "Every theory step MUST include a `citation`: a short verbatim quote copied exactly from the source that supports that step.",
    ...tailoring,
    "Respond with a single JSON object and nothing else, matching this shape:",
    "{",
    '  "title": string,',
    `  "theory": Array<{ "position": number, "heading": string, "body": string, "citation": string }> (between ${sizing.theoryMin} and ${sizing.theoryMax} items, positions starting at 0),`,
    `  "exercises": Array<{ "position": number, "prompt": string, "options": string[] (3-5), "correctIndex": number, "feedback": string }> (exactly ${sizing.mcqCount} multiple-choice items, positions starting at 0)`,
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
 * The optional `bio` (S-03) is the learner's profile background; when present it
 * tailors idiom/framing, when null/empty it is ignored. Throws GenerationError on
 * misconfiguration, API failure, or output that cannot be validated/grounded
 * after one retry.
 */
export async function generateSession(
  sourceText: string,
  intake: SessionIntake,
  bio?: string | null,
): Promise<GeneratedSession> {
  const trimmed = sourceText.trim();
  if (trimmed.length === 0) {
    throw new GenerationError("Source material is empty; nothing to generate from");
  }
  const source = trimmed.slice(0, MAX_SOURCE_CHARS);

  // Compute sizing ONCE, before the retry loop, and derive both the prompt and the
  // validation schema from it — otherwise a retry could validate against bounds the
  // prompt never requested. Bounds in → prompt + schema out, together.
  const sizing = sizeFromIntake(intake);
  const sessionSchema = makeGeneratedSessionSchema(sizing);

  const client = getOpenRouterClient();
  const model = getModel();
  const messages = buildMessages(source, intake, sizing, bio);

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

    const result = sessionSchema.safeParse(parsedJson);
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
