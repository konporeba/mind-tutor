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

import { buildValidSessionJson, DEFAULT_INTAKE, SMALL_SOURCE } from "@/test/generation/completion-builder";
import { sizeFromIntake } from "./sizing";
import { generateSession } from "./generate";

beforeEach(() => {
  create.mockReset();
});

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
