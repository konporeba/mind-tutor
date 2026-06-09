// POST /api/sessions (S-01).
//
// The single call the New Session page makes: validate the upload, generate a
// grounded session from the browser-extracted text, then persist the session,
// the original file (Storage), the material row, the theory steps, and the MCQs.
//
// Generation runs BEFORE any DB write, so the common failure (generation) leaves
// nothing half-created — the learner can simply retry.

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { generateSession } from "@/lib/services/generation/generate";
import { GenerationError } from "@/lib/services/generation/openrouter";
import type { TheoryBody } from "@/lib/services/generation/schema";
import { KNOWLEDGE_LEVELS, LEARNING_GOAL_MAX, TIME_BUDGETS, type SessionIntake, type TimeBudget } from "@/types";

export const prerender = false;

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB (NFR)
const ALLOWED_EXTENSIONS = ["pdf", "txt", "md"];

// Server-side intake validation (defense-in-depth; the form gates the same rules).
// FormData values arrive as strings, so the time budget is coerced before the
// membership check. Mirrors the `sessions` check constraints from the migration.
const IntakeSchema = z.object({
  knowledgeLevel: z.enum(KNOWLEDGE_LEVELS),
  learningGoal: z.string().trim().min(1).max(LEARNING_GOAL_MAX),
  timeBudgetMinutes: z.coerce.number().refine((n): n is TimeBudget => (TIME_BUDGETS as readonly number[]).includes(n)),
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
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

  // --- Parse + re-validate the upload (defense-in-depth; client checks too) ---
  const form = await context.request.formData();
  const file = form.get("file");
  const extractedText = form.get("extractedText");

  if (!(file instanceof File)) {
    return json({ error: "No file provided" }, 400);
  }
  if (typeof extractedText !== "string" || extractedText.trim().length === 0) {
    return json({ error: "Could not read any text from the file" }, 400);
  }
  if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) {
    return json({ error: "Unsupported file type. Upload a PDF, .txt, or .md file." }, 400);
  }
  if (file.size > MAX_SIZE_BYTES) {
    return json({ error: "File exceeds the 20 MB limit." }, 400);
  }

  // --- Validate the per-session intake (all three required) ---
  const intakeResult = IntakeSchema.safeParse({
    knowledgeLevel: form.get("knowledgeLevel"),
    learningGoal: form.get("learningGoal"),
    timeBudgetMinutes: form.get("timeBudgetMinutes"),
  });
  if (!intakeResult.success) {
    return json(
      { error: "Please choose a knowledge level, a learning goal, and an available time before starting." },
      400,
    );
  }
  const intake: SessionIntake = intakeResult.data;

  // --- Load the learner's stored bio (S-03) to tailor generation ---
  // Single read by user_id; a missing row / null bio is a valid first-class state
  // (historical sessions, skipped onboarding) and is passed through unchanged.
  const { data: profile } = await supabase.from("profiles").select("bio").eq("user_id", user.id).maybeSingle();
  const bio = profile?.bio ?? null;

  // --- Generate first; on failure nothing is persisted ---
  let generated;
  try {
    generated = await generateSession(extractedText, intake, bio);
  } catch (err) {
    if (err instanceof GenerationError) {
      console.error("[api/sessions] generation failed:", err.message);
      return json({ error: "Could not generate a session from this material. Please try again." }, 502);
    }
    throw err;
  }

  // --- Persist: session -> storage -> material -> theory -> exercises ---
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .insert({
      user_id: user.id,
      status: "active",
      title: generated.title,
      knowledge_level: intake.knowledgeLevel,
      learning_goal: intake.learningGoal,
      time_budget_minutes: intake.timeBudgetMinutes,
    })
    .select("id")
    .single();

  if (sessionError) {
    return json({ error: "Failed to create the session" }, 500);
  }

  const storagePath = `${user.id}/${session.id}/${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("materials")
    .upload(storagePath, file, { contentType: file.type || undefined, upsert: false });

  if (uploadError) {
    await supabase.from("sessions").delete().eq("id", session.id);
    return json({ error: "Failed to store the uploaded file" }, 500);
  }

  const { error: materialError } = await supabase.from("materials").insert({
    user_id: user.id,
    session_id: session.id,
    filename: file.name,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    storage_path: storagePath,
    extracted_text: extractedText,
  });

  const theoryRows = generated.theory.map((step) => ({
    user_id: user.id,
    session_id: session.id,
    kind: "theory",
    position: step.position,
    body: { heading: step.heading, body: step.body, citation: step.citation } satisfies TheoryBody,
  }));

  const exerciseRows = generated.exercises.map((mcq) => ({
    user_id: user.id,
    session_id: session.id,
    kind: "mcq",
    position: mcq.position,
    prompt: mcq.prompt,
    options: mcq.options,
    correct_answer: mcq.options[mcq.correctIndex],
    feedback: mcq.feedback,
  }));

  const { error: contentError } = await supabase.from("generated_content").insert(theoryRows);
  const { error: exerciseError } = await supabase.from("exercises").insert(exerciseRows);

  if (materialError || contentError || exerciseError) {
    // Unexpected mid-write failure: drop the session (cascades child rows) so the
    // learner is not left with a broken, partially-generated session.
    await supabase.from("sessions").delete().eq("id", session.id);
    await supabase.storage.from("materials").remove([storagePath]);
    return json({ error: "Failed to save the generated session" }, 500);
  }

  return json({ id: session.id }, 201);
};
