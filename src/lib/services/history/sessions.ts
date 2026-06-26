// Session history read helpers (S-06).
//
// Small, client-taking functions so the SSR read path is testable through the
// two-identity RLS harness (src/test/integration/setup.ts) rather than against
// inline `.astro` frontmatter. RLS scopes every read to the owning learner; no
// explicit user_id filter is required (the policy keys off auth.uid()).

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import type { Session } from "@/types";

/** The columns the dashboard history list needs per session. */
export type SessionListItem = Pick<Session, "id" | "title" | "status" | "score" | "created_at">;

/**
 * The current learner's sessions for the dashboard history list, newest first.
 * Returns [] when there are none (or on read error — the dashboard degrades to
 * an empty list rather than failing the page render).
 */
export async function listSessions(supabase: SupabaseClient<Database>): Promise<SessionListItem[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, title, status, score, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[history] listSessions failed:", error.message);
    return [];
  }
  return data;
}
