// generateSession contract tests (test-plan Phase 1).
//
// Risk #2: a valid source + complete intake must yield a schema-valid session OR a
// clean GenerationError — never a silent break. Risk #1 (structural): every theory
// citation is a verbatim span of the source. We exercise the REAL parse/validate/
// ground/retry path with only the OpenRouter network edge mocked (the getOpenRouterClient
// seam). buildMessages/prompt wording is covered by generate.test.ts — not re-tested here.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeOpenRouterClient, makeCompletion } from "@/test/generation/openrouter-mock";

// Hoisted so the (hoisted) vi.mock factory can reference it. Spread importOriginal to
// keep the real GenerationError (tests assert instanceof) and getModel.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/services/generation/openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/generation/openrouter")>()),
  getOpenRouterClient: () => fakeOpenRouterClient(create),
}));

import {
  buildLargeSource,
  buildValidSession,
  buildValidSessionJson,
  DEFAULT_INTAKE,
  FILLER_SPAN,
  SMALL_SOURCE,
} from "@/test/generation/completion-builder";
import { sizeFromIntake } from "./sizing";
import { generateSession } from "./generate";
import { GenerationError } from "./openrouter";

beforeEach(() => {
  create.mockReset();
});

/** Resolve to the rejection reason, or fail if the promise unexpectedly resolves. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected the promise to reject, but it resolved");
    },
    (err: unknown) => err,
  );
}

describe("generateSession — happy path (Risk #2 success contract)", () => {
  it("returns a schema-valid session for a valid source + intake", async () => {
    create.mockResolvedValue(makeCompletion(buildValidSessionJson(DEFAULT_INTAKE)));

    const session = await generateSession(SMALL_SOURCE, DEFAULT_INTAKE);
    const sizing = sizeFromIntake(DEFAULT_INTAKE);

    expect(session.title.length).toBeGreaterThan(0);
    expect(session.theory.length).toBeGreaterThanOrEqual(sizing.theoryMin);
    expect(session.theory.length).toBeLessThanOrEqual(sizing.theoryMax);
    expect(session.exercises).toHaveLength(sizing.mcqCount);
    for (const mcq of session.exercises) {
      expect(mcq.correctIndex).toBeLessThan(mcq.options.length);
    }
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("succeeds with a learner bio and without one (bio is optional tailoring)", async () => {
    create.mockResolvedValue(makeCompletion(buildValidSessionJson(DEFAULT_INTAKE)));

    const withBio = await generateSession(SMALL_SOURCE, DEFAULT_INTAKE, "Senior backend engineer.");
    expect(typeof withBio.title).toBe("string");

    const noBio = await generateSession(SMALL_SOURCE, DEFAULT_INTAKE, null);
    expect(typeof noBio.title).toBe("string");
  });
});

describe("generateSession — failure modes (Risk #2: never a silent break)", () => {
  it("(empty-source pre-flight) rejects with GenerationError before any API call", async () => {
    const err = await rejection(generateSession("   ", DEFAULT_INTAKE));

    expect(err).toBeInstanceOf(GenerationError);
    expect((err as GenerationError).message).toContain("empty");
    expect(create).not.toHaveBeenCalled();
  });

  it("(API throw) rejects with GenerationError when the OpenRouter call fails", async () => {
    create.mockRejectedValue(new Error("network down"));

    const err = await rejection(generateSession(SMALL_SOURCE, DEFAULT_INTAKE));

    expect(err).toBeInstanceOf(GenerationError);
    expect((err as GenerationError).message).toContain("API call failed");
  });

  it("(empty content) rejects with GenerationError when the model returns no content", async () => {
    create.mockResolvedValue(makeCompletion(null));

    const err = await rejection(generateSession(SMALL_SOURCE, DEFAULT_INTAKE));

    expect(err).toBeInstanceOf(GenerationError);
    expect((err as GenerationError).message).toContain("empty response");
  });

  it("(invalid JSON) rejects with GenerationError when the response is not JSON", async () => {
    create.mockResolvedValue(makeCompletion("this is not json"));

    const err = await rejection(generateSession(SMALL_SOURCE, DEFAULT_INTAKE));

    expect(err).toBeInstanceOf(GenerationError);
    expect((err as GenerationError).message).toContain("not valid JSON");
  });

  it("(schema-invalid) rejects with GenerationError when correctIndex is out of range", async () => {
    const session = buildValidSession(DEFAULT_INTAKE);
    session.exercises[0].correctIndex = 99; // valid count, invalid index → trips the schema refine
    create.mockResolvedValue(makeCompletion(JSON.stringify(session)));

    const err = await rejection(generateSession(SMALL_SOURCE, DEFAULT_INTAKE));

    expect(err).toBeInstanceOf(GenerationError);
    expect((err as GenerationError).message).toContain("schema validation");
  });

  it("(ungrounded citation) rejects with GenerationError when a citation is absent from the source", async () => {
    const session = buildValidSession(DEFAULT_INTAKE);
    session.theory[0].citation = "a sentence that does not appear anywhere in the source";
    create.mockResolvedValue(makeCompletion(JSON.stringify(session)));

    const err = await rejection(generateSession(SMALL_SOURCE, DEFAULT_INTAKE));

    expect(err).toBeInstanceOf(GenerationError);
    expect((err as GenerationError).message).toContain("citation not found in source");
  });
});

describe("generateSession — retry semantics (MAX_ATTEMPTS = 2)", () => {
  it("recovers when a bad first attempt is followed by a valid second attempt", async () => {
    create
      .mockResolvedValueOnce(makeCompletion("not json")) // attempt 1 fails the JSON parse
      .mockResolvedValueOnce(makeCompletion(buildValidSessionJson(DEFAULT_INTAKE))); // attempt 2 succeeds

    const session = await generateSession(SMALL_SOURCE, DEFAULT_INTAKE);

    expect(session.title.length).toBeGreaterThan(0);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("throws after exactly MAX_ATTEMPTS when every attempt fails", async () => {
    create.mockResolvedValue(makeCompletion("not json"));

    const err = await rejection(generateSession(SMALL_SOURCE, DEFAULT_INTAKE));

    expect(err).toBeInstanceOf(GenerationError);
    expect((err as GenerationError).message).toContain("after 2 attempts");
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe("generateSession — structural grounding (Risk #1, structural only)", () => {
  // The ungrounded → GenerationError anchor lives in the failure-modes block above
  // ("ungrounded citation"); here we pin the matcher's documented tolerances.

  it("accepts a session whose every theory citation is a verbatim span of the source", async () => {
    create.mockResolvedValue(makeCompletion(buildValidSessionJson(DEFAULT_INTAKE)));

    const session = await generateSession(SMALL_SOURCE, DEFAULT_INTAKE);
    expect(session.theory.length).toBeGreaterThan(0);
  });

  it("grounds a citation that differs from the source only in letter case", async () => {
    const session = buildValidSession(DEFAULT_INTAKE);
    // Uppercased copy of a real source span: the matcher lowercases both sides.
    session.theory[0].citation = session.theory[0].citation.toUpperCase();
    create.mockResolvedValue(makeCompletion(JSON.stringify(session)));

    await expect(generateSession(SMALL_SOURCE, DEFAULT_INTAKE)).resolves.toBeDefined();
  });

  it("grounds a citation that differs from the source only in whitespace", async () => {
    const session = buildValidSession(DEFAULT_INTAKE);
    const span = session.theory[0].citation;
    // Re-space the span with a newline + doubled spaces: whitespace is normalized away.
    session.theory[0].citation = span.replace(" ", "\n\n").replace(" ", "   ");
    create.mockResolvedValue(makeCompletion(JSON.stringify(session)));

    await expect(generateSession(SMALL_SOURCE, DEFAULT_INTAKE)).resolves.toBeDefined();
  });

  it("flags a citation whose only occurrence sits beyond the 60k source truncation", async () => {
    const citedSpan = "Photosynthesis converts light energy into chemical energy stored in glucose.";
    const largeSource = buildLargeSource(citedSpan); // citedSpan placed only after char 61_000

    const session = buildValidSession(DEFAULT_INTAKE, {
      theory: [
        { position: 0, heading: "A", body: "B", citation: FILLER_SPAN }, // groundable within the slice
        { position: 1, heading: "A", body: "B", citation: FILLER_SPAN },
        { position: 2, heading: "A", body: "B", citation: citedSpan }, // truncated away → ungrounded
      ],
    });
    create.mockResolvedValue(makeCompletion(JSON.stringify(session)));

    const err = await rejection(generateSession(largeSource, DEFAULT_INTAKE));

    expect(err).toBeInstanceOf(GenerationError);
    expect((err as GenerationError).message).toContain("citation not found in source");
  });
});
