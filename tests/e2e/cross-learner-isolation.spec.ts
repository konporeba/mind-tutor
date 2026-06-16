// cross-learner-isolation.spec.ts
//
// Risk:  context/foundation/test-plan.md → Risk #3 (High impact) — "Cross-learner
//        isolation / IDOR: a learner reads another learner's session by guessing
//        IDs." Phase 2 integration covers the /api/* endpoints with a second
//        identity; this covers the DISTINCT browser surface Phase 2 doesn't: the
//        SSR page guard at src/pages/sessions/[id].astro, which must redirect a
//        non-owner to /dashboard (RLS .single() → error → redirect) and leak no
//        content.
//
// Real vs mocked: ALL real — auth (storageState = E2E_OWNER), Astro routing +
//        middleware, the SSR page, Supabase RLS. No external LLM is involved.
// Setup:  a session owned by a SEPARATE learner (E2E_OTHER), seeded via service role.

import { test, expect } from "@playwright/test";
import { seedForeignSession } from "./support/factories";
import { deleteSession } from "./support/cleanup";

let foreignSessionId: string | null = null;

test.afterEach(async () => {
  if (foreignSessionId) {
    await deleteSession(foreignSessionId);
    foreignSessionId = null;
  }
});

test("a learner cannot open another learner's session and sees no leaked content", async ({ page }) => {
  // A session owned by someone else (storageState authenticates us as E2E_OWNER).
  const { sessionId, title, secretPrompt } = await seedForeignSession();
  foreignSessionId = sessionId;

  // Attempt the IDOR: navigate straight to the foreign session's URL.
  await page.goto(`/sessions/${sessionId}`);

  // The page guard must bounce us to /dashboard — not render the session.
  await page.waitForURL(/\/dashboard$/);
  await expect(page).toHaveURL(/\/dashboard$/);

  // If isolation broke, the foreign session's content would render here.
  await expect(page.getByText(title)).toHaveCount(0);
  await expect(page.getByText(secretPrompt)).toHaveCount(0);
});
