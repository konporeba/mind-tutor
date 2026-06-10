// Integration-suite stub for the `astro:env/server` virtual module.
//
// Unlike the unit stub (astro-env-server.ts, dummy values), the handler-layer
// isolation slices import `@/lib/supabase`, whose `createClient` reads the REAL
// SUPABASE_URL / SUPABASE_KEY from this module. We re-export the live local-stack
// anon key + URL so a handler that is NOT mocked could still build a real,
// RLS-scoped client. Wired via the alias in vitest.integration.config.ts.

import { SUPABASE_URL as URL, SUPABASE_ANON_KEY } from "@/test/integration/env";

export const SUPABASE_URL = URL;
export const SUPABASE_KEY = SUPABASE_ANON_KEY;
