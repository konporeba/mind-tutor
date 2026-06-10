// Two-identity bootstrap for the DB-backed isolation suite (test-plan Phase 2).
//
// Exposes two REAL authenticated learners (A and B) so specs can prove cross-learner
// isolation against live Postgres + RLS. Identity is a real JWT obtained via
// signInWithPassword on an anon-key client — exactly the shape the app resolves from
// the session cookie (research: cookie-borne JWT on the anon key). The service-role
// key is used ONLY here to seed the two users; every assertion runs through the
// anon-key clients so RLS is the thing under test.
//
// Fixed users + idempotent seeding: re-runs reuse learner-a/learner-b (createUser
// duplicates are swallowed), and each spec creates its own rows per run (see
// factories.ts), so a second run or a mid-run failure never poisons state.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from "@/test/integration/env";

const PASSWORD = "integration-test-password";
const EMAIL_A = "learner-a@test.local";
const EMAIL_B = "learner-b@test.local";

export interface Identity {
  client: SupabaseClient<Database>;
  userId: string;
}

export interface Identities {
  clientA: SupabaseClient<Database>;
  clientB: SupabaseClient<Database>;
  userAId: string;
  userBId: string;
  /** Service-role client — seeding/inspection only; never used in assertions. */
  adminClient: SupabaseClient<Database>;
}

function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Create a confirmed user if absent; swallow "already registered" so re-runs are safe. */
async function ensureUser(admin: SupabaseClient<Database>, email: string): Promise<void> {
  const { error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error && !/already.*registered|already.*exists|email_exists/i.test(error.message)) {
    throw new Error(`[integration] failed to seed ${email}: ${error.message}`);
  }
}

/** Sign in as `email` on a fresh anon-key client and return the authed client + user id. */
async function signIn(email: string): Promise<Identity> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) {
    throw new Error(`[integration] failed to sign in ${email}: ${error.message}`);
  }
  return { client, userId: data.user.id };
}

async function bootstrap(): Promise<Identities> {
  const admin = adminClient();
  await ensureUser(admin, EMAIL_A);
  await ensureUser(admin, EMAIL_B);
  const a = await signIn(EMAIL_A);
  const b = await signIn(EMAIL_B);
  return { clientA: a.client, clientB: b.client, userAId: a.userId, userBId: b.userId, adminClient: admin };
}

let cached: Promise<Identities> | null = null;

/** Memoized per worker: seed (idempotent) + sign in both learners exactly once. */
export function getIdentities(): Promise<Identities> {
  return (cached ??= bootstrap());
}
