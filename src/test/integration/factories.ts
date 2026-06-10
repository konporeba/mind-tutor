// Owned-row factory for the isolation suite (test-plan Phase 2).
//
// Creates a full session graph (session + material + theory step + one MCQ) owned by
// the caller, so an isolation spec has a concrete victim row for the OTHER identity to
// attack. Inserts go through the owner's authed client and pass `user_id` explicitly,
// mirroring the real handlers (sessions/index.ts) — RLS `with check` validates the
// stamp. Columns mirror the F-01 baseline migration.
//
// Each call inserts fresh rows (new uuids) so runs stay independent (fixed users,
// per-run unique data). Orphan rows are harmless and cleared by `supabase db reset`.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

export interface SessionGraphIds {
  sessionId: string;
  materialId: string;
  contentId: string;
  exerciseId: string;
}

export interface SessionGraphOverrides {
  title?: string;
  correctAnswer?: string;
  options?: string[];
  feedback?: string;
}

/** Insert a session + child rows owned by `userId`, returning the created ids. */
export async function createSessionGraph(
  client: SupabaseClient<Database>,
  userId: string,
  overrides: SessionGraphOverrides = {},
): Promise<SessionGraphIds> {
  const options = overrides.options ?? ["A", "B", "C", "D"];
  const correctAnswer = overrides.correctAnswer ?? options[0];

  const { data: session, error: sessionError } = await client
    .from("sessions")
    .insert({
      user_id: userId,
      status: "active",
      title: overrides.title ?? "Isolation fixture session",
      knowledge_level: "intermediate",
      learning_goal: "isolation fixture",
      time_budget_minutes: 30,
    })
    .select("id")
    .single();
  if (sessionError) {
    throw new Error(`[integration] failed to create session: ${sessionError.message}`);
  }
  const sessionId = session.id;

  const { data: material, error: materialError } = await client
    .from("materials")
    .insert({
      user_id: userId,
      session_id: sessionId,
      filename: "fixture.txt",
      mime_type: "text/plain",
      size_bytes: 42,
      storage_path: `${userId}/${sessionId}/fixture.txt`,
      extracted_text: "fixture source text",
    })
    .select("id")
    .single();
  if (materialError) {
    throw new Error(`[integration] failed to create material: ${materialError.message}`);
  }

  const { data: content, error: contentError } = await client
    .from("generated_content")
    .insert({
      user_id: userId,
      session_id: sessionId,
      kind: "theory",
      position: 0,
      body: { heading: "Fixture", body: "Fixture theory", citation: "fixture source text" },
    })
    .select("id")
    .single();
  if (contentError) {
    throw new Error(`[integration] failed to create generated_content: ${contentError.message}`);
  }

  const { data: exercise, error: exerciseError } = await client
    .from("exercises")
    .insert({
      user_id: userId,
      session_id: sessionId,
      kind: "mcq",
      position: 1,
      prompt: "Fixture question?",
      options,
      correct_answer: correctAnswer,
      feedback: overrides.feedback ?? "Fixture feedback",
    })
    .select("id")
    .single();
  if (exerciseError) {
    throw new Error(`[integration] failed to create exercise: ${exerciseError.message}`);
  }

  return { sessionId, materialId: material.id, contentId: content.id, exerciseId: exercise.id };
}
