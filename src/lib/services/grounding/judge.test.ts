// Grounding judge — deterministic wiring unit (test-plan Phase 4).
//
// Proves the judge's PURE glue with the model call stubbed (no network, no key):
// the distractor-exemption payload builder, verdict parsing, pass/fail aggregation,
// and malformed-response handling. Discrimination (does the judge actually catch a
// planted hallucination?) is the LIVE suite's job (judge.livejudge.test.ts) — here
// we never pay a model to verify a switch statement. Runs under default `npm test`.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeOpenRouterClient, makeCompletion } from "@/test/generation/openrouter-mock";

// Hoisted so the (hoisted) vi.mock factory can reference it. Spread importOriginal to
// keep the real getModel; override only the client seam.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/services/generation/openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/generation/openrouter")>()),
  getOpenRouterClient: () => fakeOpenRouterClient(create),
}));

import type { GeneratedSession } from "@/lib/services/generation/schema";
import { buildGroundingClaims, GroundingError, judgeGrounding } from "./judge";

beforeEach(() => {
  create.mockReset();
});

/** A session with a 3-option MCQ: one correct answer + two distractors. */
function sampleSession(): GeneratedSession {
  return {
    title: "Photosynthesis Basics",
    theory: [
      {
        position: 0,
        heading: "Light to chemical energy",
        body: "Photosynthesis converts light energy into chemical energy.",
        citation: "Photosynthesis converts light energy into chemical energy",
      },
    ],
    exercises: [
      {
        position: 0,
        prompt: "What does photosynthesis convert light energy into?",
        options: ["Chemical energy", "Kinetic energy", "Sound energy"],
        correctIndex: 0,
        feedback: "Photosynthesis stores energy as chemical energy.",
      },
    ],
  };
}

const SOURCE = "Photosynthesis converts light energy into chemical energy.";

describe("buildGroundingClaims — distractor exemption (the load-bearing rule)", () => {
  it("submits prompt, the correct option, feedback, theory body/heading, title — never distractors", () => {
    const claims = buildGroundingClaims(sampleSession());
    const texts = claims.map((c) => c.text);

    // Correct option is graded…
    expect(texts).toContain("Chemical energy");
    // …distractors are NOT (they are intentionally off-source).
    expect(texts).not.toContain("Kinetic energy");
    expect(texts).not.toContain("Sound energy");

    const fields = claims.map((c) => c.field);
    expect(fields).toContain("title");
    expect(fields).toContain("theory.heading");
    expect(fields).toContain("theory.body");
    expect(fields).toContain("mcq.prompt");
    expect(fields).toContain("mcq.correctOption");
    expect(fields).toContain("mcq.feedback");

    // Exactly one correctOption entry; the citation field is never graded.
    expect(claims.filter((c) => c.field === "mcq.correctOption")).toHaveLength(1);
  });
});

describe("judgeGrounding — verdict parsing + aggregation", () => {
  it("aggregates an all-grounded verdict (allGrounded true, ungrounded empty)", async () => {
    create.mockResolvedValue(
      makeCompletion(
        JSON.stringify({
          claims: [
            {
              field: "theory.body",
              claim: "Photosynthesis converts light into chemical energy",
              grounded: true,
              sourceSpan: "converts light energy into chemical energy",
              reasoning: "stated in source",
            },
            {
              field: "mcq.correctOption",
              claim: "Chemical energy is the product",
              grounded: true,
              sourceSpan: "chemical energy",
              reasoning: "supported",
            },
          ],
        }),
      ),
    );

    const result = await judgeGrounding(sampleSession(), SOURCE);

    expect(result.allGrounded).toBe(true);
    expect(result.ungrounded).toHaveLength(0);
    expect(result.claims).toHaveLength(2);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("surfaces an ungrounded claim in the ungrounded subset", async () => {
    create.mockResolvedValue(
      makeCompletion(
        JSON.stringify({
          claims: [
            {
              field: "theory.body",
              claim: "Photosynthesis occurs only at night",
              grounded: false,
              sourceSpan: null,
              reasoning: "source says nothing about night",
            },
            {
              field: "mcq.feedback",
              claim: "Energy is stored as chemical energy",
              grounded: true,
              sourceSpan: "chemical energy",
              reasoning: "ok",
            },
          ],
        }),
      ),
    );

    const result = await judgeGrounding(sampleSession(), SOURCE);

    expect(result.allGrounded).toBe(false);
    expect(result.ungrounded).toHaveLength(1);
    expect(result.ungrounded[0]?.field).toBe("theory.body");
  });
});

describe("judgeGrounding — malformed responses throw GroundingError (never a silent pass)", () => {
  it("throws on an empty response", async () => {
    create.mockResolvedValue(makeCompletion(null));
    await expect(judgeGrounding(sampleSession(), SOURCE)).rejects.toBeInstanceOf(GroundingError);
  });

  it("throws on a non-JSON response", async () => {
    create.mockResolvedValue(makeCompletion("not json at all"));
    await expect(judgeGrounding(sampleSession(), SOURCE)).rejects.toBeInstanceOf(GroundingError);
  });

  it("throws on a schema-invalid response", async () => {
    create.mockResolvedValue(makeCompletion(JSON.stringify({ claims: [{ field: "bogus", grounded: "yes" }] })));
    await expect(judgeGrounding(sampleSession(), SOURCE)).rejects.toBeInstanceOf(GroundingError);
  });

  it("propagates an API error as GroundingError", async () => {
    create.mockRejectedValue(new Error("network down"));
    await expect(judgeGrounding(sampleSession(), SOURCE)).rejects.toBeInstanceOf(GroundingError);
  });
});
