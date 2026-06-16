// Shared service-role client + test identities for the E2E suite (test infra only).
//
// The service-role key lives ONLY in test infrastructure (mirrors
// src/test/integration/env.ts) — never in src/. Keys come from SUPABASE_TEST_*,
// which playwright.config.ts auto-loads from `supabase status`.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The storageState user (the authenticated "us") and a SEPARATE foreign owner used
// to prove cross-learner isolation. Both seeded into local Supabase.
export const E2E_OWNER_EMAIL = "e2e-learner@test.local";
export const E2E_OTHER_EMAIL = "e2e-other@test.local";
export const E2E_PASSWORD = "e2e-test-password";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[e2e] Missing ${name}. Start local Supabase with \`npx supabase start\` ` +
        `(keys come from \`supabase status\`), or export ${name} manually.`,
    );
  }
  return value;
}

let cached: SupabaseClient | null = null;

/** Cached service-role client (RLS bypassed) — seeding/cleanup only, never assertions. */
export function admin(): SupabaseClient {
  return (cached ??= createClient(required("SUPABASE_TEST_URL"), required("SUPABASE_TEST_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
}

/** Create a confirmed user if absent and return its id (idempotent across runs). */
export async function ensureUser(email: string): Promise<string> {
  const a = admin();
  const created = await a.auth.admin.createUser({ email, password: E2E_PASSWORD, email_confirm: true });
  if (created.data.user?.id) return created.data.user.id;
  if (created.error && !/already.*(registered|exists)|email_exists/i.test(created.error.message)) {
    throw new Error(`[e2e] createUser failed for ${email}: ${created.error.message}`);
  }
  const { data, error } = await a.auth.admin.listUsers();
  if (error) throw new Error(`[e2e] listUsers failed: ${error.message}`);
  const id = data.users.find((u) => u.email === email)?.id;
  if (!id) throw new Error(`[e2e] could not resolve id for ${email}`);
  return id;
}
