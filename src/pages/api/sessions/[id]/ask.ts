// POST /api/sessions/[id]/ask (S-05, FR-008).
//
// Answer a learner's mid-session question, grounded strictly in the session's
// uploaded material, STREAMED back as Server-Sent Events. Each turn is persisted to
// conversation_messages so S-06 history can replay it.
//
// Persist ordering is load-bearing: the user question is written BEFORE the model
// call (a crash/abort never loses the question), and the assistant answer is written
// only AFTER the stream completes (no partial/garbage answers are stored). An aborted
// stream therefore leaves a user turn with no paired answer — the SSR load and panel
// render that as an unanswered question, not an error.
//
// Ownership: load-before-act on the session (RLS + nothing leaks on a cross-account
// target). Source + prior turns are read RLS-scoped to the learner.

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { answerQuestion, MAX_PRIOR_TURNS, type QaTurn } from "@/lib/services/qa/answer";

export const prerender = false;

const QuestionSchema = z.object({ question: z.string().trim().min(1).max(1000) });

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const encoder = new TextEncoder();

// One SSE frame. The delta is JSON-encoded so newlines/quotes in the answer survive
// the line-oriented SSE wire format; the client JSON.parses each `data:` payload.
function sse(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
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

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const parsed = QuestionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json({ error: "Invalid request body" }, 400);
  }
  const question = parsed.data.question;

  // Load-before-act: a non-owned/missing session 404s before anything is read or written.
  const { error: sessionError } = await supabase.from("sessions").select("id").eq("id", sessionId).single();
  if (sessionError) {
    return json({ error: "Session not found" }, 404);
  }

  // Grounding corpus: concatenate every material's extracted text for this session.
  const { data: materials, error: materialsError } = await supabase
    .from("materials")
    .select("extracted_text")
    .eq("session_id", sessionId);
  if (materialsError) {
    return json({ error: "Failed to load source material" }, 500);
  }
  const sourceText = materials
    .map((m) => m.extracted_text ?? "")
    .join("\n\n")
    .trim();
  if (!sourceText) {
    return json({ error: "This session has no source material to answer from" }, 422);
  }

  // Load only the most recent turns needed for follow-up context (newest first), bounded
  // so a long session never triggers a full-table read. The newest row's position gives
  // the next position (max + 1); the rows are reversed to chronological order for the prompt.
  const { data: recentRows, error: priorError } = await supabase
    .from("conversation_messages")
    .select("role, content, position")
    .eq("session_id", sessionId)
    .order("position", { ascending: false })
    .limit(MAX_PRIOR_TURNS);
  if (priorError) {
    return json({ error: "Failed to load conversation" }, 500);
  }
  const userPosition = recentRows.length > 0 ? recentRows[0].position + 1 : 0;
  const priorTurns: QaTurn[] = recentRows
    .slice()
    .reverse()
    .map((r) => ({ role: r.role as QaTurn["role"], content: r.content }));

  // Persist the user turn BEFORE the model call so it is never lost on abort.
  const { error: userInsertError } = await supabase.from("conversation_messages").insert({
    user_id: user.id,
    session_id: sessionId,
    role: "user",
    position: userPosition,
    content: question,
  });
  if (userInsertError) {
    return json({ error: "Failed to record the question" }, 500);
  }

  // Stream the grounded answer; persist the assistant turn only once the stream completes.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      try {
        for await (const delta of answerQuestion(sourceText, priorTurns, question)) {
          answer += delta;
          controller.enqueue(sse(delta));
        }
        if (answer) {
          const { error: assistantInsertError } = await supabase.from("conversation_messages").insert({
            user_id: user.id,
            session_id: sessionId,
            role: "assistant",
            position: userPosition + 1,
            content: answer,
          });
          if (assistantInsertError) {
            // The answer was already streamed to the client, but persistence failed
            // (e.g. a position collision from a concurrent ask). Log it and warn the UI
            // so the learner knows this turn won't survive a reload — never a silent desync.
            console.error("[api/sessions/ask] assistant turn insert failed:", assistantInsertError.message);
            controller.enqueue(sse({ warning: "This answer could not be saved and may disappear on reload." }));
          }
        }
        controller.enqueue(sse("[DONE]"));
      } catch (err) {
        // Surface the failure to the client; the user turn stays persisted, the
        // assistant turn is intentionally NOT written (renders as unanswered).
        controller.enqueue(sse({ error: err instanceof Error ? err.message : "Failed to answer" }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
};
