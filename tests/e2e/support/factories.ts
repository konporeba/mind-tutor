// Owned-row factory for the E2E isolation spec (Risk #3).
//
// Creates a session graph owned by a SEPARATE learner (E2E_OTHER), so the
// storageState user (E2E_OWNER) can attempt — and must fail — to read it through
// the browser. Inserts go through the service role (RLS bypassed) with an explicit
// user_id, exactly the foreign owner the isolation guard must protect against.

import { admin, ensureUser, E2E_OTHER_EMAIL } from "./supabase-admin";

export interface ForeignSession {
  sessionId: string;
  ownerId: string;
  /** Unique per run so the spec can assert it never leaks into the rendered page. */
  title: string;
  /** A theory/exercise string the spec asserts is never visible to a non-owner. */
  secretPrompt: string;
}

/** Seed a session (owned by E2E_OTHER) with content + one exercise; return its ids. */
export async function seedForeignSession(): Promise<ForeignSession> {
  const ownerId = await ensureUser(E2E_OTHER_EMAIL);
  const a = admin();
  const stamp = Date.now();
  const title = `Foreign session ${stamp}`;
  const secretPrompt = `Secret question ${stamp}?`;

  const { data: session, error } = await a
    .from("sessions")
    .insert({
      user_id: ownerId,
      status: "active",
      title,
      knowledge_level: "intermediate",
      learning_goal: "foreign-owner fixture",
      time_budget_minutes: 30,
    })
    .select("id")
    .single();
  if (error) throw new Error(`[e2e] failed to seed foreign session: ${error.message}`);
  const sessionId = session.id as string;

  const { error: contentError } = await a.from("generated_content").insert({
    user_id: ownerId,
    session_id: sessionId,
    kind: "theory",
    position: 0,
    body: { heading: "Secret heading", body: "Secret theory body", citation: "secret source" },
  });
  if (contentError) throw new Error(`[e2e] failed to seed foreign content: ${contentError.message}`);

  const { error: exerciseError } = await a.from("exercises").insert({
    user_id: ownerId,
    session_id: sessionId,
    kind: "mcq",
    position: 1,
    prompt: secretPrompt,
    options: ["A", "B", "C", "D"],
    correct_answer: "A",
    feedback: "Secret feedback",
  });
  if (exerciseError) throw new Error(`[e2e] failed to seed foreign exercise: ${exerciseError.message}`);

  return { sessionId, ownerId, title, secretPrompt };
}
