import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// First JS unit-test harness for this repo (S-02). Scoped to pure-logic modules
// (sizing map + prompt builder) — no DOM, no network. The `@/*` alias mirrors
// tsconfig/Astro so test imports resolve the same way app code does.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Stub Astro's server-env virtual module so the generation import graph
      // resolves under Vitest (the tests never touch the OpenRouter client).
      "astro:env/server": fileURLToPath(new URL("./src/test/stubs/astro-env-server.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // DB-backed integration specs (`*.integration.test.ts`) require local Supabase, and
    // live AI-native grounding specs (`*.livejudge.test.ts`) make a real, keyed model
    // call — both run via their own config/script (`test:integration`, `test:livejudge`).
    // Keep them out of the default suite so `npm test` needs no Supabase, no network, no key.
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts", "**/*.livejudge.test.ts"],
  },
});
