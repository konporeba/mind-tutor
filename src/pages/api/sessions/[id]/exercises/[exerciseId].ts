// POST /api/sessions/[id]/exercises/[exerciseId] (S-01, FR-010).
//
// Record the learner's answer to one MCQ and return immediate feedback. RLS plus
// the explicit session_id match prevent answering another learner's exercise.

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

export const prerender = false;

const AnswerSchema = z.object({ answer: z.string().min(1) });

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

  const { id: sessionId, exerciseId } = context.params;
  if (!sessionId || !exerciseId) {
    return json({ error: "Missing session or exercise id" }, 400);
  }

  let parsed;
  try {
    parsed = AnswerSchema.parse(await context.request.json());
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const { data: exercise, error: loadError } = await supabase
    .from("exercises")
    .select("id, correct_answer, feedback")
    .eq("id", exerciseId)
    .eq("session_id", sessionId)
    .single();

  if (loadError) {
    return json({ error: "Exercise not found" }, 404);
  }

  const isCorrect = exercise.correct_answer === parsed.answer;

  const { error: updateError } = await supabase
    .from("exercises")
    .update({
      learner_answer: parsed.answer,
      is_correct: isCorrect,
      answered_at: new Date().toISOString(),
    })
    .eq("id", exerciseId)
    .eq("session_id", sessionId);

  if (updateError) {
    return json({ error: "Failed to record the answer" }, 500);
  }

  return json({ is_correct: isCorrect, feedback: exercise.feedback, correct_answer: exercise.correct_answer }, 200);
};
