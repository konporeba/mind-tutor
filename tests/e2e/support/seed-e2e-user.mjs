// Seed a confirmed + onboarded E2E test user into LOCAL Supabase.
//
// Idempotent: re-runs reuse the same user. Uses the service-role key (test infra
// only) pulled straight from `supabase status` so no key is copied by hand. The
// upsert mirrors POST /api/onboarding exactly ({ user_id, bio, onboarded_at }),
// so the middleware onboarding gate is satisfied and the user lands on protected
// routes instead of /onboarding.
//
// Run:  node tests/e2e/support/seed-e2e-user.mjs

import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

export const E2E_EMAIL = "e2e-learner@test.local";
export const E2E_PASSWORD = "e2e-test-password";

function localEnv() {
  const out = execSync("npx --yes supabase status -o env", { encoding: "utf8" });
  const env = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
    if (m) env[m[1]] = m[2];
  }
  if (!env.API_URL || !env.SERVICE_ROLE_KEY) {
    throw new Error("Could not read API_URL/SERVICE_ROLE_KEY from `supabase status`. Is local Supabase running?");
  }
  return env;
}

async function main() {
  const env = localEnv();
  const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Create the user (confirmed). Swallow "already exists" so re-runs are safe.
  const created = await admin.auth.admin.createUser({
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
    email_confirm: true,
  });
  if (created.error && !/already.*(registered|exists)|email_exists/i.test(created.error.message)) {
    throw new Error(`createUser failed: ${created.error.message}`);
  }

  // Resolve the user id (works whether just-created or pre-existing).
  let userId = created.data?.user?.id;
  if (!userId) {
    const { data, error } = await admin.auth.admin.listUsers();
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    userId = data.users.find((u) => u.email === E2E_EMAIL)?.id;
  }
  if (!userId) throw new Error(`Could not resolve id for ${E2E_EMAIL}`);

  // Satisfy the onboarding gate (mirrors POST /api/onboarding).
  const { error: upsertError } = await admin
    .from("profiles")
    .upsert({ user_id: userId, bio: "E2E test user", onboarded_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (upsertError) throw new Error(`profile upsert failed: ${upsertError.message}`);

  console.log(`✓ E2E user ready: ${E2E_EMAIL} (id ${userId}) — confirmed + onboarded`);
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
