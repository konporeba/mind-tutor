# E2E tests (Playwright)

Browser-level coverage for the risks in `context/foundation/test-plan.md`. See
`E2E_RULES.md` for the conventions every spec follows, and `seed.spec.ts` for the
canonical exemplar.

## One-time setup

1. **Install browsers:** `npx playwright install chromium`
2. **Run local Supabase:** `npx supabase start` (the suite runs against the local
   stack, never remote — see below).
3. **Point the dev server at local Supabase + enable the generation stub.** The
   dev server reads `.dev.vars` (gitignored), so set it for E2E:

   ```
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_KEY=<local anon key from `supabase status`>
   OPENROUTER_API_KEY=<any value — unused when the stub is on>
   OPENROUTER_MODEL=openai/gpt-4o-mini
   E2E_STUB_OPENROUTER=true
   ```

   `E2E_STUB_OPENROUTER=true` makes `generateSession` return a canned session
   instead of calling OpenRouter, so `seed.spec.ts` is deterministic and free.
   Keep a copy of your normal (remote) `.dev.vars` as `.dev.vars.remote` and
   restore it for regular dev (`cp .dev.vars.remote .dev.vars`).

4. **Seed the test users:**
   - `node tests/e2e/support/seed-e2e-user.mjs` — the storageState learner
     (`e2e-learner@test.local`), confirmed + onboarded.
   - The foreign owner (`e2e-other@test.local`) is seeded on demand by
     `support/factories.ts`.

5. **Capture auth state** into `playwright/.auth/user.json` (gitignored): log in
   once as `e2e-learner@test.local` and save the session (e.g. via the Playwright
   CLI `state-save`, or an `auth.setup.ts` project).

## Running

```
npx playwright test                 # whole suite (starts the dev server itself)
npx playwright test seed            # a single spec
```

`playwright.config.ts` auto-loads the local service-role key into `SUPABASE_TEST_*`
(for `support/cleanup.ts`) and starts/reuses the dev server.

## Notes

- **Local only.** Specs seed and delete rows with the service role and depend on the
  seeded users — never point them at a shared/remote project.
- **Cleanup.** Specs that create a session delete it in `afterEach`; data uses unique
  `Date.now()` ids so repeated/parallel runs don't collide. (Uploaded Storage objects
  from `seed.spec.ts` are not pruned — harmless, unique per run.)
