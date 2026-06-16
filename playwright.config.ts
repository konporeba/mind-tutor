import { execSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

// E2E suite (test-plan §4 "e2e" layer). Specs live in tests/e2e and run against a
// real dev server (auth/routing/DB stay REAL — see tests/e2e/E2E_RULES.md).
//
// Auth: storageState captured once (playwright/.auth/user.json) — tests never log
// in through the UI. Re-capture by re-running the login + `state-save` flow, or via
// a future auth.setup.ts project.
//
// Local Supabase keys: pulled from `supabase status -o env` and exposed as
// SUPABASE_TEST_* (same names the integration suite uses) so the cleanup helper
// (tests/e2e/support/cleanup.ts) can delete created rows with the service role.
// Setting them on process.env here propagates to the worker child processes.
function loadSupabaseTestEnv(): void {
  try {
    const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const pick = (key: string): string | undefined => new RegExp(`^${key}="(.*)"$`, "m").exec(out)?.[1];
    const url = pick("API_URL");
    const service = pick("SERVICE_ROLE_KEY");
    if (url) process.env.SUPABASE_TEST_URL ??= url;
    if (service) process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ??= service;
  } catch {
    // Stack down / CLI missing — cleanup.ts fails fast with guidance when it runs.
  }
}
loadSupabaseTestEnv();

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4321";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    storageState: "playwright/.auth/user.json",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
