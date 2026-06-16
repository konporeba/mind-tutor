// Test-only data cleanup for the E2E suite.
//
// MindTutor exposes no delete endpoint and no delete UI, so an E2E test that
// creates a session cannot clean up through the browser. This deletes the created
// row graph with the shared service-role client (see supabase-admin.ts). Children
// first, in case the schema has no ON DELETE CASCADE, so re-runs leave no orphans.

import { admin } from "./supabase-admin";

export async function deleteSession(sessionId: string): Promise<void> {
  const a = admin();
  await a.from("exercises").delete().eq("session_id", sessionId);
  await a.from("generated_content").delete().eq("session_id", sessionId);
  await a.from("materials").delete().eq("session_id", sessionId);
  await a.from("sessions").delete().eq("id", sessionId);
}
