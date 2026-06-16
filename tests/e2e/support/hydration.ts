import type { Page } from "@playwright/test";

// Astro renders client:load islands as <astro-island ... ssr> and removes the
// `ssr` attribute once the React island has hydrated. Clicking a button whose
// onClick lives in that island BEFORE hydration races handler attachment (the
// click lands on inert SSR markup). This is a readiness gate on Astro's own
// hydration marker — not a locator for an interactive element — so it stays
// within the role-based-locator rule while waiting for STATE, never time.
export async function waitForIslandHydrated(page: Page, componentNameFragment: string): Promise<void> {
  await page.waitForFunction((frag) => {
    const el = document.querySelector(`astro-island[component-url*="${frag}"]`);
    return !!el && !el.hasAttribute("ssr");
  }, componentNameFragment);
}
