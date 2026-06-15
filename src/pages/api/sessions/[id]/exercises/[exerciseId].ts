// POST /api/sessions/[id]/exercises/[exerciseId] (S-01, extended in S-04).
//
// Record the learner's answer to one exercise and return immediate feedback.
// Grading branches on the exercise kind (mcq / fill_blank / matching) via the
// pure gradeAnswer module. RLS plus the explicit session_id match prevent
// answering another learner's exercise. The exercise is loaded BEFORE the answer
// is parsed, so a cross-account/missing target is a clean 404 with nothing leaked.

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { gradeAnswer } from "@/lib/services/grading";

export const prerender = false;

// mcq + fill_blank submit a single string; matching submits a left→right mapping.
const StringAnswerSchema = z.object({ answer: z.string().min(1) });
const MatchingAnswerSchema = z.object({ answer: z.record(z.string(), z.string()) });

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

  // Load first (RLS + session_id guard) — a non-owned/missing target 404s before
  // we read or grade any answer.
  const { data: exercise, error: loadError } = await supabase
    .from("exercises")
    .select("id, kind, correct_answer, feedback, answered_at")
    .eq("id", exerciseId)
    .eq("session_id", sessionId)
    .single();

  if (loadError) {
    return json({ error: "Exercise not found" }, 404);
  }

  // Guard against replay/tamper: an answered exercise is immutable, and a
  // completed session accepts no further answers (its score is final).
  if (exercise.answered_at) {
    return json({ error: "This exercise has already been answered" }, 409);
  }
  const { data: sessionRow } = await supabase.from("sessions").select("status").eq("id", sessionId).single();
  if (sessionRow?.status === "completed") {
    return json({ error: "This session is already complete" }, 409);
  }

  // Parse the submitted answer per kind.
  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  let submitted: string | Record<string, string>;
  if (exercise.kind === "matching") {
    const parsed = MatchingAnswerSchema.safeParse(rawBody);
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }
    submitted = parsed.data.answer;
  } else {
    const parsed = StringAnswerSchema.safeParse(rawBody);
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }
    submitted = parsed.data.answer;
  }

  const isCorrect = gradeAnswer({ kind: exercise.kind, correct_answer: exercise.correct_answer, submitted });

  const { error: updateError } = await supabase
    .from("exercises")
    .update({
      learner_answer: submitted,
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
