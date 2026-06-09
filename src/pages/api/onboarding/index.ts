// POST /api/onboarding (S-03).
//
// The single write that satisfies the onboarding gate: accept the learner's
// scripted onboarding answers, distill them into a free-text bio, and upsert the
// caller's `profiles` row with the bio + an `onboarded_at` marker. distillBio
// never throws (it falls back to raw answers), so an LLM outage cannot lock a
// new learner out of the product.

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { distillBio } from "@/lib/services/onboarding/distill";

export const prerender = false;

// A bounded set of short free-text answers from the scripted onboarding chat.
// Caps keep the distill input (and the raw-answer fallback) a bounded ingredient.
const ANSWER_MAX = 1000;
const AnswersSchema = z.object({
  answers: z.array(z.string().trim().min(1).max(ANSWER_MAX)).min(1).max(10),
});

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

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const parsed = AnswersSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Please answer each onboarding question before finishing." }, 400);
  }

  // distillBio never throws — on any LLM failure it returns the concatenated raw
  // answers, so the forced onboarding flow always completes.
  const bio = await distillBio(parsed.data.answers);

  const { error: upsertError } = await supabase
    .from("profiles")
    .upsert({ user_id: user.id, bio, onboarded_at: new Date().toISOString() }, { onConflict: "user_id" });

  if (upsertError) {
    console.error("[api/onboarding] profile upsert failed:", upsertError.message);
    return json({ error: "Failed to save your profile. Please try again." }, 500);
  }

  return json({ ok: true }, 201);
};
