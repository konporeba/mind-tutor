import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Live AI-native grounding-judge harness (test-plan Phase 4). Kept SEPARATE from the
// default vitest.config.ts so `npm test` never makes a model call (it stays
// deterministic, network-free, and key-free). Only `*.livejudge.test.ts` run here, via
// `npm run test:livejudge`, and they make a REAL, paid, non-deterministic OpenRouter
// call — this is the optional §5 grounding-judge gate.
//
// Best-effort: surface OPENROUTER_API_KEY / OPENROUTER_MODEL from process.env, or from
// .dev.vars / .env, into the suite so a configured local dev needs no manual export. If
// the key is absent, src/test/grounding/env.ts fails fast with guidance — the suite
// never silently passes without a key.
function loadLiveJudgeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ["OPENROUTER_API_KEY", "OPENROUTER_MODEL"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  if (!env.OPENROUTER_API_KEY) {
    for (const file of [".dev.vars", ".env"]) {
      try {
        const text = readFileSync(file, "utf8");
        const pick = (name: string): string | undefined =>
          new RegExp(`^${name}=(.*)$`, "m")
            .exec(text)?.[1]
            ?.trim()
            .replace(/^["']|["']$/g, "");
        const apiKey = pick("OPENROUTER_API_KEY");
        if (apiKey) {
          env.OPENROUTER_API_KEY = apiKey;
          const model = pick("OPENROUTER_MODEL");
          if (model && !env.OPENROUTER_MODEL) env.OPENROUTER_MODEL = model;
          break;
        }
      } catch {
        // file missing — try the next candidate
      }
    }
  }
  return env;
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The judge import graph reads `astro:env/server`. Point it at the live stub that
      // surfaces the REAL OpenRouter key + model (not the dummy unit stub).
      "astro:env/server": fileURLToPath(new URL("./src/test/stubs/astro-env-server.livejudge.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.livejudge.test.ts"],
    env: loadLiveJudgeEnv(),
    // A live model call far exceeds the 5s default.
    testTimeout: 30_000,
  },
});
