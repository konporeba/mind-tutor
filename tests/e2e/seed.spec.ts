// seed.spec.ts — the E2E quality lever for MindTutor.
//
// This is the EXEMPLAR every generated E2E test is modeled on. What you show is
// what you get: if this seed uses getByRole, generated tests do too; if it ever
// gained a page.waitForTimeout, every generated test would inherit that flake.
// Read tests/e2e/E2E_RULES.md alongside this file.
//
// Risk:  context/foundation/test-plan.md → Risk #2 (High × High) — "Generation
//        pipeline silently fails: a valid file + complete intake still yields no
//        session." The browser-observable proof of protection is that a real
//        learner who uploads a valid file and completes intake lands on a
//        rendered /sessions/:id (never a silent break or an opaque error), and
//        that the session survives a real SSR page reload.
//
// Real vs mocked boundaries (the core value of an E2E test):
//   • REAL   — auth (storageState), Astro routing + middleware, /api/sessions,
//              Supabase/Postgres + RLS, the SSR reload. This is where the
//              integration risk that Risk #2 names actually lives.
//   • MOCKED — the OpenRouter LLM only. It is non-deterministic, costs money,
//              and is called SERVER-SIDE, so page.route() cannot reach it; it is
//              stubbed at the server seam (getOpenRouterClient) via the
//              E2E_STUB_OPENROUTER flag the Playwright webServer sets. Wiring
//              that stub + storageState belongs to the Playwright setup step.

import { test, expect } from "@playwright/test";
import { deleteSession } from "./support/cleanup";
import { waitForIslandHydrated } from "./support/hydration";

// storageState (configured in playwright.config.ts) means we arrive already
// authenticated and onboarded — never log in through the UI inside a test.

// Each run creates exactly one session; we capture its id to clean up after,
// so the suite is safe to run repeatedly and in parallel.
let createdSessionId: string | null = null;

test.afterEach(async () => {
  // No delete exists in the UI/API, so cleanup uses a service-role client
  // (mirrors src/test/integration). Removing the row keeps re-runs collision-free.
  if (createdSessionId) {
    await deleteSession(createdSessionId);
    createdSessionId = null;
  }
});

// Runs deterministically because the dev server is started with
// E2E_STUB_OPENROUTER=true (see tests/e2e/README.md), so generation returns a
// canned session instead of a real OpenRouter call.
test("a generated session is created and persists after page reload", async ({ page }) => {
  // Unique marker so this run's data never collides with a parallel run or a re-run.
  const learningGoal = `E2E seed — explain the core idea (${Date.now()})`;

  // --- Action: complete the new-session intake the way a real learner would ---
  await page.goto("/sessions/new");
  // The form's handlers live in the React island — wait for it to hydrate first.
  await waitForIslandHydrated(page, "NewSessionForm");

  // The file <input> is hidden behind a styled button; drive it through the
  // role-based button + the filechooser event — never a CSS/DOM selector.
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose a file" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles("tests/e2e/fixtures/sample-source.md");

  await page.getByRole("button", { name: "intermediate" }).click();
  await page.getByLabel("What do you want to get out of this session?").fill(learningGoal);
  await page.getByRole("button", { name: "~30 min" }).click();

  await page.getByRole("button", { name: "Start session" }).click();

  // --- Wait for STATE, not time: the redirect to the created session page. ---
  await page.waitForURL(/\/sessions\/[0-9a-f-]+$/);
  createdSessionId = new URL(page.url()).pathname.split("/").pop() ?? null;

  // --- Assert the BUSINESS OUTCOME of Risk #2: a real session rendered. ---
  // If generation had silently failed, we'd still be on /sessions/new with the
  // form's role="alert" error — this heading would never appear, so this
  // assertion fails exactly when the risk materializes.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // --- Persistence across a real SSR reload (the cross-boundary part). ---
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
