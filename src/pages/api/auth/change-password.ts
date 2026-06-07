import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

const MIN_PASSWORD_LENGTH = 8;

function fail(context: Parameters<APIRoute>[0], message: string) {
  return context.redirect(`/account?error=${encodeURIComponent(message)}`);
}

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const currentPassword = form.get("currentPassword") as string;
  const newPassword = form.get("newPassword") as string;
  const confirmPassword = form.get("confirmPassword") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return fail(context, "Supabase is not configured");
  }

  const email = context.locals.user?.email;
  if (!email) {
    return context.redirect("/auth/signin");
  }

  // Server-side guard rails (defense-in-depth behind client validation).
  if (!currentPassword || !newPassword || !confirmPassword) {
    return fail(context, "All fields are required");
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return fail(context, `New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (newPassword !== confirmPassword) {
    return fail(context, "New password and confirmation do not match");
  }
  if (newPassword === currentPassword) {
    return fail(context, "New password must be different from the current password");
  }

  // Verify the current password via re-auth — updateUser does not check it.
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (verifyError) {
    return fail(context, "Current password is incorrect");
  }

  // Update the password. Token rotation writes new cookies via setAll, so the
  // session stays valid and the learner is not forced to re-login.
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    return fail(context, updateError.message);
  }

  return context.redirect(`/account?success=${encodeURIComponent("Password updated")}`);
};
