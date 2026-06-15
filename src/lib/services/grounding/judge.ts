// Grounding fidelity judge (test-plan Phase 4).
//
// Detects factual claims in generated session PROSE — theory body/heading, MCQ
// prompt, the CORRECT option, and feedback — that the uploaded source does not
// support. This is the SEMANTIC remainder of Risk #1: the slice the structural
// citation check (generation/generate.ts findUngroundedCitation, theory[].citation
// only, substring match) cannot reach. One live model call, asserted against
// hand-authored adversarial fixtures whose PASS/FLAG labels are the oracle — never
// the model's own output (the §2 oracle anti-pattern).
//
// Reuses the OpenRouter seam (getOpenRouterClient / getModel) — the repo reaches
// every model through OpenRouter's OpenAI-compatible API, not the Anthropic SDK.
// Deliberately NOT wired into the production generation path; this is a test-layer
// asset that lives in lib/ for reuse and is tree-shaken out of the worker bundle.

import { getModel, getOpenRouterClient } from "@/lib/services/generation/openrouter";
import type { GeneratedSession } from "@/lib/services/generation/schema";
import { GroundingVerdictSchema, type ClaimVerdict, type GroundingField } from "./schema";

// Ground against the SAME 60k-truncated slice the generator saw (generate.ts
// MAX_SOURCE_CHARS) — grounding against full text would wrongly pass claims
// supported only by truncated-away content.
const MAX_SOURCE_CHARS = 60_000;
const MAX_TOKENS = 4000;

/** Thrown for any failure judging grounding: API error, empty/invalid-JSON, or a
 *  response that fails the verdict schema. The judge surfaces a verdict or throws —
 *  it never silently degrades (unlike onboarding/distill.ts). */
export class GroundingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GroundingError";
  }
}

/** A gradable prose unit submitted to the judge. Distractors are never built into
 *  this list — only options[correctIndex] is, tagged "mcq.correctOption". */
export interface GroundingClaim {
  field: GroundingField;
  text: string;
}

export interface GroundingResult {
  /** Per-atomic-claim verdicts the judge returned. */
  claims: ClaimVerdict[];
  /** The subset the judge marked not grounded. */
  ungrounded: ClaimVerdict[];
  /** True iff every claim is grounded. */
  allGrounded: boolean;
}

/** Resolve the gradable prose surfaces of a session into the judge's input list.
 *  THE distractor exemption lives here: only options[correctIndex] is submitted;
 *  the other (intentionally off-source) options are never sent for grounding. */
export function buildGroundingClaims(session: GeneratedSession): GroundingClaim[] {
  const claims: GroundingClaim[] = [];

  if (session.title.trim()) {
    claims.push({ field: "title", text: session.title });
  }

  for (const step of session.theory) {
    claims.push({ field: "theory.heading", text: step.heading });
    claims.push({ field: "theory.body", text: step.body });
  }

  for (const ex of session.exercises) {
    // Only MCQ prose surfaces are graded here. Grounding coverage for the S-04
    // fill_blank / matching prose is deferred (the judge is an out-of-prod test
    // asset; extending its field taxonomy is its own task, not part of S-04).
    if (ex.kind !== "mcq") continue;
    claims.push({ field: "mcq.prompt", text: ex.prompt });
    // The schema's correctIndex-in-range check guarantees this resolves to the
    // correct answer string on any schema-valid session — never a distractor.
    claims.push({ field: "mcq.correctOption", text: ex.options[ex.correctIndex] });
    claims.push({ field: "mcq.feedback", text: ex.feedback });
  }

  return claims;
}

/** Build the judge messages. Inverts the generator's grounding instruction: verify
 *  each claim against the source and flag anything not supported. Pure: same source
 *  + claims always yield the same messages. */
export function buildJudgeMessages(sourceSlice: string, claims: GroundingClaim[]) {
  const numbered = claims.map((c, i) => `${i + 1}. [${c.field}] ${c.text}`).join("\n");

  const system = [
    "You are a strict grounding verifier for an AI study tutor.",
    "You are given SOURCE MATERIAL and a numbered list of STATEMENTS taken from a generated study session.",
    "Decompose each statement into its atomic factual claims, and for EACH claim decide whether the SOURCE MATERIAL supports it.",
    "A claim is grounded ONLY if the source explicitly states it or directly entails it. If the source does not support a claim, or contradicts it, it is NOT grounded.",
    "Use ONLY the provided source — never outside knowledge. Generic pedagogical or instructional phrasing that asserts no fact about the subject is grounded by default.",
    "Respond with a single JSON object and nothing else, matching this shape:",
    "{",
    '  "claims": Array<{',
    '    "field": one of "title" | "theory.heading" | "theory.body" | "mcq.prompt" | "mcq.correctOption" | "mcq.feedback",',
    '    "claim": string (the atomic claim, in your own words),',
    '    "grounded": boolean,',
    '    "sourceSpan": string | null (a short verbatim quote from the source supporting the claim, or null when not grounded),',
    '    "reasoning": string (one short sentence)',
    "  }>",
    "}",
    'Set "field" to the bracketed label of the statement each claim came from.',
  ].join("\n");

  const user = `SOURCE MATERIAL:\n"""\n${sourceSlice}\n"""\n\nSTATEMENTS:\n${numbered}`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

/**
 * Judge whether every factual claim in a session's prose is grounded in `source`.
 * Makes one live model call (temperature 0 + JSON mode for reproducibility) and
 * zod-validates the verdict. Throws GroundingError on API failure, empty/invalid
 * JSON, or a schema-invalid response — never returns a partial/untyped result.
 */
export async function judgeGrounding(session: GeneratedSession, source: string): Promise<GroundingResult> {
  const sourceSlice = source.trim().slice(0, MAX_SOURCE_CHARS);
  const claims = buildGroundingClaims(session);
  const messages = buildJudgeMessages(sourceSlice, claims);

  const client = getOpenRouterClient();
  const model = getModel();

  let raw: string | null | undefined;
  try {
    const completion = await client.chat.completions.create({
      model,
      messages,
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: MAX_TOKENS,
    });
    raw = completion.choices[0]?.message?.content;
  } catch (err) {
    throw new GroundingError(`Judge API call failed: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }

  if (!raw) {
    throw new GroundingError("Judge returned an empty response");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    throw new GroundingError("Judge response was not valid JSON", { cause: err });
  }

  const result = GroundingVerdictSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new GroundingError(
      `Judge response failed schema validation: ${result.error.issues[0]?.message ?? "unknown"}`,
    );
  }

  const ungrounded = result.data.claims.filter((c) => !c.grounded);
  return {
    claims: result.data.claims,
    ungrounded,
    allGrounded: ungrounded.length === 0,
  };
}
