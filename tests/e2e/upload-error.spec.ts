// upload-error.spec.ts
//
// Risk:  context/foundation/test-plan.md → Risk #5 — "Upload / parse error not
//        surfaced: an unsupported/corrupt/oversize/empty file silently breaks or
//        returns an opaque error instead of a clean explanatory message BEFORE
//        generation runs." test-plan §7 records that the New-Session form's own
//        client-side error surfacing is NOT covered by any unit test (no
//        jsdom/RTL) — this E2E closes exactly that gap in the real rendered UI.
//
// Real vs mocked: ALL real — the validation runs client-side in the browser island
//        before any network/LLM call, so nothing is mocked. No session is created,
//        so there is no cleanup.

import { test, expect } from "@playwright/test";
import { waitForIslandHydrated } from "./support/hydration";

test("an unsupported file is rejected with a clear error before generation runs", async ({ page }) => {
  await page.goto("/sessions/new");
  // The file picker's onClick lives in the React island — wait for it to hydrate.
  await waitForIslandHydrated(page, "NewSessionForm");

  // Pick an unsupported file via the role-based button + filechooser (no CSS selector).
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose a file" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles("tests/e2e/fixtures/unsupported.png");

  // The form must surface a clean, explanatory error — not a silent break.
  await expect(page.getByRole("alert")).toHaveText("Unsupported file type. Upload a PDF, .txt, or .md file.");

  // ...and must NOT advance toward generation: we stay on the new-session page.
  await expect(page).toHaveURL(/\/sessions\/new$/);
});
