# E2E Testing Rules (MindTutor)

Read this before generating or editing any Playwright test. These rules + the
exemplar in `seed.spec.ts` are the two quality levers — they constrain generated
tests so they are stable by default. `CLAUDE.md` carries the short version; this
file is the canonical, MindTutor-tuned source.

## The rules block

- Use `getByRole`, `getByLabel`, `getByText` as primary locators. Fall back to
  `getByTestId` only when accessibility attributes are genuinely ambiguous.
- Never use CSS selectors, XPath, or DOM structure to locate elements. (The
  hidden file `<input>` is the one exception class: drive it via the role-based
  "Choose a file" button + the `filechooser` event, as the seed does — not a
  `input[type=file]` selector.)
- Each test must be independently runnable — no shared state between tests; safe
  under parallel, random-order runs.
- Never use `page.waitForTimeout()`. Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- Assert the **business outcome**, not implementation details or LLM wording
  (output is non-deterministic — see test-plan §7).
- Use unique identifiers (e.g. a `Date.now()` suffix) for any data a test
  creates, to avoid collisions in parallel runs.
- Clean up created data in `afterEach`. MindTutor has no delete endpoint/UI, so
  cleanup uses the service-role helper in `support/cleanup.ts`.
- Authenticate via `storageState` (Playwright config) — never log in through the
  UI inside a test. The stored user must be **onboarded** (middleware forces
  `/onboarding` otherwise).

## Real vs mocked — the core of an E2E test

E2E ≠ zero mocking. Keep **internal** boundaries real; mock only the expensive,
non-deterministic **external** API.

- **REAL:** Supabase auth, Astro middleware/routing, the `/api/*` endpoints,
  Postgres + RLS, SSR reloads. This is where MindTutor's integration risk lives.
- **MOCKED:** the OpenRouter LLM only. It is called **server-side**, so
  `page.route()` cannot intercept it — stub it at the server seam
  (`getOpenRouterClient`), gated by an env flag the Playwright `webServer` sets.
  Do not mock auth or the DB, or the test stops protecting anything real.

## Governing rules

- **Don't generate from scratch — start from a risk.** Pick the risk from
  `context/foundation/test-plan.md`; a risk earns an E2E test only when it
  crosses several boundaries (auth → routing → API → DB) or exists only in the
  rendered UI. If an isolated function or integration test can prove it, it
  belongs in `/10x-tdd`, not here.
- **Name the test after the risk:** `test('a generated session is created and
  persists after page reload', ...)`, never `test('test 1', ...)`.
- **The assertion must fail if the risk materializes.** Control question for
  every assertion: *would this fail if the test-plan risk came true?* If not,
  it's decorative. Confirm with a deliberate-break check, then revert it.
- **One test per file**, placed in `tests/e2e/<feature>.spec.ts`. Carry a
  provenance header linking the spec to its risk (see `seed.spec.ts`).
- **Protect the named risk, not surface area** — no test-per-page/per-button.

## Source authority

Every rule above traces to Playwright's official Best Practices and Test
Assertions docs: `getByRole` is the recommended default locator; tests must be
fully isolated; web-first assertions wait for conditions while `waitForTimeout`
is a designated anti-pattern; `storageState` is the standard auth pattern.
