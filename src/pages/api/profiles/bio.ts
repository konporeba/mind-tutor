import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { BIO_MAX } from "@/types";

export const prerender = false;

// Validate the edited bio server-side (defense-in-depth behind the client). The
// learner edits the distilled onboarding bio directly, so it is saved raw —
// trimmed, non-empty, and capped so it stays a bounded prompt ingredient.
const BioSchema = z.string().trim().min(1).max(BIO_MAX);

function fail(context: Parameters<APIRoute>[0], message: string) {
  return context.redirect(`/account?bioError=${encodeURIComponent(message)}`);
}

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const rawBio = form.get("bio");

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return fail(context, "Supabase is not configured");
  }

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const parsed = BioSchema.safeParse(rawBio);
  if (!parsed.success) {
    const tooLong = typeof rawBio === "string" && rawBio.trim().length > BIO_MAX;
    return fail(context, tooLong ? "Your bio is too long." : "Your bio can't be empty.");
  }

  // Update only the bio. The profile row is guaranteed to exist post-onboarding,
  // and RLS profiles_update_own scopes the write to the caller.
  const { error: updateError } = await supabase.from("profiles").update({ bio: parsed.data }).eq("user_id", user.id);
  if (updateError) {
    return fail(context, updateError.message);
  }

  return context.redirect(`/account?bioSuccess=${encodeURIComponent("Bio updated")}`);
};
