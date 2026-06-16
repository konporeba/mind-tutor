// Live-judge stub for the `astro:env/server` virtual module (test-plan Phase 4).
//
// Unlike the unit stub (astro-env-server.ts, dummy "test-key"), the live grounding
// suite makes a REAL OpenRouter call, so this re-exports the real key + model from
// env.ts (which fail-fasts when the key is absent). Wired via the alias in
// vitest.livejudge.config.ts.

import { OPENROUTER_API_KEY as KEY, OPENROUTER_MODEL as MODEL } from "@/test/grounding/env";

export const OPENROUTER_API_KEY = KEY;
export const OPENROUTER_MODEL = MODEL;
export const E2E_STUB_OPENROUTER = false;
