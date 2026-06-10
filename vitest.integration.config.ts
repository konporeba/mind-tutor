import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// DB-backed integration harness (test-plan Phase 2). Kept SEPARATE from the default
// `vitest.config.ts` so `npm test` never requires Supabase (CI + Docker-less devs stay
// green). Only `*.integration.test.ts` files run here, via `npm run test:integration`.
//
// Best-effort: pull the local stack's URL + keys from `supabase status -o env` and feed
// them to the suite as SUPABASE_TEST_* so a started stack needs no manual export. If the
// CLI is missing or the stack is down, we inject nothing and src/test/integration/env.ts
// fails fast with guidance.
function loadSupabaseTestEnv(): Record<string, string> {
  try {
    const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const pick = (key: string): string | undefined => new RegExp(`^${key}="(.*)"$`, "m").exec(out)?.[1];
    const url = pick("API_URL");
    const anon = pick("ANON_KEY");
    const service = pick("SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return {};
    return {
      SUPABASE_TEST_URL: url,
      SUPABASE_TEST_ANON_KEY: anon,
      SUPABASE_TEST_SERVICE_ROLE_KEY: service,
    };
  } catch {
    return {};
  }
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Handler-layer slices import `@/lib/supabase`, which reads `astro:env/server`.
      // Point it at the integration stub that re-exports the REAL local anon key + URL
      // (not the dummy unit stub), so an unmocked handler builds a real RLS client.
      "astro:env/server": fileURLToPath(new URL("./src/test/stubs/astro-env-server.integration.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    env: loadSupabaseTestEnv(),
  },
});
