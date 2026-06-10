// Local-Supabase connection details for the DB-backed integration suite (test-plan
// Phase 2). These are read from `process.env`; `vitest.integration.config.ts`
// auto-populates them from `npx supabase status -o env` so a started local stack
// needs no manual export. If the stack is down (or the CLI is missing), the
// fail-fast below names the fix.
//
// The service-role key lives ONLY here, in test infrastructure — never in `src/`
// application code, which stays anon-key + RLS (see research: no service-role
// client anywhere in src/). It is used solely by the test bootstrap to seed users.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[integration] Missing ${name}. Start local Supabase with \`npx supabase start\` ` +
        `(the config auto-loads keys from \`supabase status\`), or export ${name} manually.`,
    );
  }
  return value;
}

export const SUPABASE_URL = required("SUPABASE_TEST_URL");
export const SUPABASE_ANON_KEY = required("SUPABASE_TEST_ANON_KEY");
export const SUPABASE_SERVICE_ROLE_KEY = required("SUPABASE_TEST_SERVICE_ROLE_KEY");
