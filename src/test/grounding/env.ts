// Real OpenRouter credentials for the live grounding-judge suite (test-plan Phase 4).
//
// Read from process.env; vitest.livejudge.config.ts auto-loads them from .dev.vars /
// .env so a configured local dev needs no manual export. The live suite makes a REAL,
// paid, non-deterministic model call — if the key is absent, the fail-fast below names
// the fix rather than letting the suite silently pass without a key.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[livejudge] Missing ${name}. The live grounding-judge suite makes a real OpenRouter call. ` +
        `Set ${name} in your .env or .dev.vars (the config auto-loads it), or export it manually.`,
    );
  }
  return value;
}

export const OPENROUTER_API_KEY = required("OPENROUTER_API_KEY");
// Reuse the generator's model (the plan decision — judge shares the generator's model);
// default mirrors astro.config.mjs's OPENROUTER_MODEL default.
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
