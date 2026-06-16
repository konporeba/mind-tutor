// Smoke test for the storageState auth lever (test-plan §4 e2e layer).
//
// Proves a spec starts ALREADY authenticated — no UI login — by reaching a
// protected route directly. If storageState were missing/expired, middleware
// would redirect to /auth/signin and this fails. Cheap guard for the lever every
// other E2E test depends on.

import { test, expect } from "@playwright/test";

test("authenticated session reaches the dashboard without logging in", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("e2e-learner@test.local")).toBeVisible();
});
