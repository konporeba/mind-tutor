// Test stub for the `astro:env/server` virtual module.
//
// Vitest runs outside the Astro build, where this virtual module does not exist.
// The sizing/prompt tests only need the generation import graph to RESOLVE — they
// exercise the pure buildMessages, never the OpenRouter client — so dummy values
// are sufficient. Wired in via the alias in vitest.config.ts.
export const OPENROUTER_API_KEY = "test-key";
export const OPENROUTER_MODEL = "test-model";
export const E2E_STUB_OPENROUTER = false;
