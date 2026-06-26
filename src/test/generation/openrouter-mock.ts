// OpenRouter mock helper for the generation service (test-plan Phase 1).
//
// The generation import graph already RESOLVES under Vitest via the `astro:env/server`
// alias (vitest.config.ts) — but that stub only supplies dummy env values; it does NOT
// intercept the network call. To drive `generateSession`'s parse → validate → ground →
// retry path we mock the single client seam, `getOpenRouterClient`, and script the
// completion it returns.
//
// USAGE (the vi.mock factory must be wired per test file because vi.mock is hoisted;
// keep the real GenerationError + getModel by spreading importOriginal):
//
//   import { makeCompletion } from "@/test/generation/openrouter-mock";
//
//   const { create } = vi.hoisted(() => ({ create: vi.fn() }));
//   vi.mock("@/lib/services/generation/openrouter", async (importOriginal) => ({
//     ...(await importOriginal<typeof import("@/lib/services/generation/openrouter")>()),
//     getOpenRouterClient: () => fakeOpenRouterClient(create),
//   }));
//
// then in tests: create.mockResolvedValue(makeCompletion(buildValidSessionJson()))
//
// The same seam backs onboarding/distill.ts, so this helper is reusable beyond Phase 1.

import type { Mock } from "vitest";

/** The OpenAI completion shape `generateSession` reads: choices[0].message.content. */
export function makeCompletion(content: string | null) {
  return { choices: [{ message: { content } }] };
}

/** Minimal fake client exposing only the surface generate.ts touches. */
export function fakeOpenRouterClient(create: Mock) {
  return { chat: { completions: { create } } };
}

/** An async-iterable streaming completion (S-05): yields one delta chunk per piece,
 *  matching the shape answerQuestion reads: choices[0].delta.content. Use as the
 *  resolved value of the `create` mock when `stream: true` is requested. */
export function makeStreamingCompletion(pieces: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const piece of pieces) {
        // Yield to a microtask so this faithfully models async delta arrival.
        await Promise.resolve();
        yield { choices: [{ delta: { content: piece } }] };
      }
    },
  };
}
