import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/account", "/sessions"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  const isProtected = PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route));

  if (isProtected && !context.locals.user) {
    return context.redirect("/auth/signin");
  }

  // Onboarding gate (S-03): an authenticated learner who has not completed
  // onboarding (no profile row, or a null `onboarded_at`) is forced to
  // /onboarding before any protected surface. The profile is read ONLY when a
  // redirect could apply — a protected path for an authenticated user — and
  // /onboarding is not itself protected, so there is no redirect loop.
  if (isProtected && context.locals.user && supabase) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarded_at")
      .eq("user_id", context.locals.user.id)
      .maybeSingle();
    if (!profile?.onboarded_at) {
      return context.redirect("/onboarding");
    }
  }

  return next();
});
