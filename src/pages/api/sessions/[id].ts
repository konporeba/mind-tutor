// DELETE /api/sessions/[id] (S-07, FR-016).
//
// Hard-delete one of the learner's sessions and everything tied to it. The DB
// cascade (session_id -> sessions, on delete cascade) clears every child row —
// materials, generated_content, exercises, conversation_messages — when the
// session row goes. Storage objects are NOT covered by the cascade, so they are
// removed explicitly here.
//
// Ordering is load-bearing: the material rows hold the storage paths, and the
// cascade deletes those rows. So we read the paths FIRST, remove the Storage
// objects, and only THEN delete the session row. If Storage removal fails we
// abort before the row delete — nothing is half-deleted from the learner's view
// and a retry is clean. RLS scopes every statement to the owner (auth.uid()).

import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const DELETE: APIRoute = async (context) => {
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

  // Confirm the session exists and is owned by the learner (RLS-scoped). A
  // non-owner or missing id sees no row -> 404, mirroring the complete handler.
  const { error: sessionError } = await supabase.from("sessions").select("id").eq("id", sessionId).single();

  if (sessionError) {
    return json({ error: "Session not found" }, 404);
  }

  // 1. Collect the session's Storage paths BEFORE the cascade removes the rows.
  const { data: materials, error: materialsError } = await supabase
    .from("materials")
    .select("storage_path")
    .eq("session_id", sessionId);

  if (materialsError) {
    return json({ error: "Failed to load session files" }, 500);
  }

  const storagePaths = materials.map((m) => m.storage_path).filter((p): p is string => p !== null);

  // 2. Remove the Storage objects. On failure, abort before deleting the row so
  //    nothing is half-deleted and the learner can retry cleanly.
  if (storagePaths.length > 0) {
    const { error: removeError } = await supabase.storage.from("materials").remove(storagePaths);
    if (removeError) {
      console.error("[api/sessions] storage removal failed:", removeError.message);
      return json({ error: "Failed to delete the session files. Please try again." }, 500);
    }
  }

  // 3. Delete the session row; the DB cascade clears all child rows.
  const { error: deleteError } = await supabase.from("sessions").delete().eq("id", sessionId);

  if (deleteError) {
    return json({ error: "Failed to delete the session" }, 500);
  }

  return json({ ok: true }, 200);
};
