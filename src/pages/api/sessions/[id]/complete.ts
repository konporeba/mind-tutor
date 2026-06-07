// POST /api/sessions/[id]/complete (S-01, FR-011).
//
// Finalize a session: compute the percent-correct score from the persisted
// exercise rows and mark the session completed. Idempotent.

import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { computeScore } from "@/lib/services/scoring";

export const prerender = false;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Not authenticated" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase is not configured" }, 500);
  }

  const sessionId = context.params.id;
  if (!sessionId) {
    return json({ error: "Missing session id" }, 400);
  }

  // Confirm the session exists and is owned by the learner (RLS-scoped).
  const { error: sessionError } = await supabase.from("sessions").select("id").eq("id", sessionId).single();

  if (sessionError) {
    return json({ error: "Session not found" }, 404);
  }

  const { data: exercises, error: exercisesError } = await supabase
    .from("exercises")
    .select("is_correct")
    .eq("session_id", sessionId);

  if (exercisesError) {
    return json({ error: "Failed to load exercises" }, 500);
  }

  const score = computeScore(exercises);

  const { error: updateError } = await supabase
    .from("sessions")
    .update({ score, status: "completed", completed_at: new Date().toISOString() })
    .eq("id", sessionId);

  if (updateError) {
    return json({ error: "Failed to complete the session" }, 500);
  }

  return json({ score }, 200);
};
