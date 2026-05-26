# Cloudflare Workers Integration & First Deploy

## Context

`context/foundation/infrastructure.md` (researched 2026-05-25) selected **Cloudflare Workers** for MindTutor's MVP deployment. The scaffold is mostly there — `@astrojs/cloudflare` v13.5 is installed, `astro.config.mjs` declares the adapter with `output: "server"`, `wrangler.jsonc` already targets Workers (has `main`, `assets`), and `src/lib/supabase.ts` uses `astro:env/server` correctly. What remains: rename the Worker, migrate secrets out of `.env` into Workers Secrets Store, add a CI deploy job, set up the two Cloudflare MCP servers, and execute the first deploy.

**Scope choices (confirmed):** single prod Worker (no staging yet), R2/Queue deferred until PDF upload feature lands, Workers Observability + Bindings MCP servers wired, **free tier** to start (with explicit watch for the 10 ms CPU ceiling).

**Not in scope:** R2 buckets, Queues, staging Worker, Durable Objects, Cloudflare Access, custom domain, paid plan migration, secret-scanning pre-commit hook (flagged for later — see Phase 7).

---

## Phase 0 — Pre-flight verification (read-only, ~5 min)

- [x] Confirm Cloudflare account exists for the user (manual: log into dash.cloudflare.com).
- [x] Verify Node v22.14.0 active (`node -v`) — `.nvmrc` requires it; mismatch breaks `wrangler dev`. *(Verified 2026-05-25: `node -v` → `v22.14.0`.)*
- [x] Verify `git status` is clean before any edits (so the deploy commit can be isolated). *(2026-05-25: Resolved by committing pre-Phase-1 state as `2911647` "Prep deploy: infra research, m1l5 lesson context, switch to Workers". Side-finding: `.env.example` had been overwritten with real Supabase URL + publishable anon key; reverted to `###` placeholders before the commit — real values stay in local `.env` (gitignored) and will move to `.dev.vars` in Phase 2. Tree clean as of this edit.)*
- [x] Re-read `wrangler.jsonc` and `astro.config.mjs` so the agent doesn't drift from current state. *(Verified 2026-05-25: `wrangler.jsonc` name still `10x-astro-starter` — Phase 1 rename pending; all other fields match plan. `astro.config.mjs` matches plan: `output: "server"`, cloudflare adapter, `env.schema` with `optional: true`.)*

**Done when:** Cloudflare account confirmed, Node version matches, working tree clean.

---

## Phase 1 — Rename Worker & verify `wrangler.jsonc` (~10 min)

The Worker name in `X:\MindTutor\wrangler.jsonc` is currently `10x-astro-starter` (bootstrap leftover). It must be `mind-tutor` before the first deploy, because the name becomes the URL slug (`mind-tutor.<account>.workers.dev`) and renaming a deployed Worker requires creating a new one and deleting the old.

- [x] Edit `wrangler.jsonc`: change `"name": "10x-astro-starter"` → `"name": "mind-tutor"`. *(Done 2026-05-25.)*
- [x] Confirm these fields are present and correct (do **not** change them, just verify):
  - `"main": "@astrojs/cloudflare/entrypoints/server"` (Astro v13 adapter generates this entrypoint at build time)
  - `"compatibility_date": "2026-05-08"` (recent enough; leave as-is)
  - `"compatibility_flags": ["nodejs_compat"]` (required by `@supabase/ssr`)
  - `"assets": { "directory": "./dist", "not_found_handling": "404-page" }`
  - `"observability": { "enabled": true }` (free; enables Workers Logs)
  *(All verified 2026-05-25; `assets` also has `"binding": "ASSETS"` which the plan didn't list — harmless, left as-is.)*
- [x] Verify `package.json` has no `"engines"` field for Node — Workers ignores it, but add `"engines": { "node": ">=22.14.0" }` so CI fails fast on version drift. *(Done 2026-05-25; added after `"version"` block.)*

**Edge case — entrypoint path:** if `npm run build` ever errors with "Cannot find module `@astrojs/cloudflare/entrypoints/server`", the adapter's published entrypoints changed. Fix: rebuild and check the actual generated path under `dist/_worker.js/` — newer adapter versions emit `./dist/_worker.js/index.js` and `main` must match.

**Observed layout divergence (2026-05-25):** `npm run build` succeeded cleanly but produced `dist/server/entry.mjs` + `dist/server/wrangler.json` + `dist/client/*` — NOT `dist/_worker.js/index.js`. This is the current `@astrojs/cloudflare` v13.5 layout: the adapter generates a *resolved* `dist/server/wrangler.json` (with `name: "mind-tutor"`, `main: "entry.mjs"`, `assets.directory: "../client"`, bindings for `IMAGES`/`SESSION`/`ASSETS`) that `wrangler deploy` consumes instead of the root `wrangler.jsonc`'s literal `main` value. The magic string `@astrojs/cloudflare/entrypoints/server` is a build-time directive the adapter rewrites, not a real path. **Implication for the "done when" check below:** the literal `dist/_worker.js/index.js` predicate is obsolete — substitute `dist/server/entry.mjs` exists AND `dist/server/wrangler.json` shows `name: mind-tutor`. Phase 5's `wrangler deploy --dry-run` is the real entrypoint-resolution test.

**Done when:** `wrangler.jsonc` shows `name: mind-tutor`, `npm run build` succeeds locally, `dist/server/entry.mjs` exists (adjusted from the plan's original `dist/_worker.js/index.js` — see layout-divergence note above). *(All met 2026-05-25.)*

---

## Phase 2 — Local dev secrets via `.dev.vars` (~10 min)

`@astrojs/cloudflare` v13 reads secrets in dev from `.dev.vars` (not `.env`). The repo currently has `.env.example` but no `.dev.vars.example`. `astro:env/server` will throw at runtime if the bindings are missing once we flip them to `optional: false`.

- [x] Create `X:\MindTutor\.dev.vars.example` mirroring `.env.example`:
  ```
  SUPABASE_URL=https://<project-ref>.supabase.co
  SUPABASE_KEY=<anon-or-service-role-key>
  ```
  *(Done 2026-05-25.)*
- [x] User copies it locally: `cp .dev.vars.example .dev.vars` and fills real values. *(Done 2026-05-25 — values copied from existing gitignored `.env` to `.dev.vars`; both files local-only, no secrets typed into chat.)*
- [x] Confirm `.dev.vars` is in `.gitignore` (already verified: yes). *(Re-verified 2026-05-25: line 21 of `.gitignore`.)*
- [x] Run `npm run dev` and verify the dashboard loads without an `astro:env` error. *(Verified 2026-05-25: `astro v6.3.1 ready in 39150 ms`, log shows `Using secrets defined in .dev.vars`, `GET /` → 200, `GET /auth/signin` → 200, no astro:env error.)*
- [ ] **Defer** flipping `optional: true` → `optional: false` in `astro.config.mjs` until after first prod deploy succeeds — premature tightening blocks the deploy if any binding is missed.

**Edge case — `.env` still loaded:** Astro also reads `.env` for non-prefixed vars. If both `.env` and `.dev.vars` exist with different values, `.dev.vars` wins under `wrangler dev` but `.env` wins under `astro dev` (no wrangler). Recommendation: delete `.env` once `.dev.vars` works; keep only `.env.example` for documentation. *(Done 2026-05-25: `.env` deleted; `.dev.vars` is now the single source of local secrets.)*

**Done when:** `.dev.vars.example` committed, local dashboard loads via Supabase auth. *(Phase 2 complete 2026-05-25; `.dev.vars.example` created and ready to commit in Phase 9, local dev server loads `/` and `/auth/signin` cleanly while reading secrets from `.dev.vars`. `.env` still present locally — see edge-case note below; left in place since `.dev.vars` wins under `wrangler dev`.)*

---

## Phase 3 — Cloudflare account, API token, Wrangler auth (~15 min, manual)

Token creation is browser-only. The agent cannot do this — guide the user step by step.

> **Deferred with Phase 6:** the scoped API token and GitHub Actions secrets below exist only to feed CI auto-deploy. Manual `wrangler deploy` from a developer machine uses the OAuth session from `wrangler login` and does **not** need either. Revisit when Phase 6 is picked up.

- [ ] *(Deferred)* User creates a scoped API token at https://dash.cloudflare.com/profile/api-tokens → "Create Custom Token":
  - **Permissions:** `Account` → `Workers Scripts` → `Edit`; `Account` → `Account Settings` → `Read`; `User` → `Memberships` → `Read`.
  - **Account Resources:** include only the MindTutor account.
  - **No** Zone, DNS, KV, R2, D1, Queues, or billing permissions (add later only when those bindings appear).
  - Copy the token immediately — it's shown once.
- [ ] *(Deferred)* User finds the Account ID (right sidebar of the Cloudflare dashboard, any account-scoped page).
- [ ] *(Deferred)* Add to GitHub repo secrets (Settings → Secrets and variables → Actions):
  - `CLOUDFLARE_API_TOKEN` = the token just created
  - `CLOUDFLARE_ACCOUNT_ID` = the account ID
- [x] Locally, run `npx wrangler login` (opens browser OAuth, separate from the API token, used for local CLI deploys).
- [x] Verify with `npx wrangler whoami` — should show the account email and ID. *(Verified 2026-05-25: konporeba@gmail.com, account `016342b5c7cf5429f151e7773cf26c44`.)*

**Edge case — multi-account user:** if the user belongs to multiple Cloudflare accounts, `wrangler whoami` lists them all. Add `"account_id": "<id>"` to `wrangler.jsonc` to pin deploys to MindTutor's account; otherwise `wrangler deploy` errors with "More than one account available".

**Done when:** `wrangler whoami` returns the right account, GitHub secrets populated. *(Phase 3 active scope complete 2026-05-25: local OAuth verified — single account `Konporeba@gmail.com's Account` / `016342b5c7cf5429f151e7773cf26c44`, so the multi-account `account_id` pin is unnecessary; token shows full Workers + Secrets Store scopes needed for Phases 4–5. GitHub-secrets sub-task travels with Phase 6, deferred.)*

---

## Phase 4 — Production secrets via Workers Secrets Store (~10 min, manual approval)

`wrangler secret put` is a write operation against the prod Worker — gated on human approval per the infra plan's approval rules.

- [x] **User runs** (not the agent — these prompt for the value and write directly to prod):
  ```powershell
  npx wrangler secret put SUPABASE_URL
  npx wrangler secret put SUPABASE_KEY
  ```
  Each command prompts for the secret value; values are stored in Workers Secrets Store, not the dashboard env tab. *(Done 2026-05-25 by user; placeholder Worker `mind-tutor` created on first `secret put` as expected.)*
- [x] **Do not** add `SUPABASE_URL` or `SUPABASE_KEY` to the `vars` block in `wrangler.jsonc` — that block is plaintext and committed to git. *(Verified: `wrangler.jsonc` has no `vars` block; secrets stay in Secrets Store only.)*
- [x] Verify with `npx wrangler secret list` — should show both names (values are not shown). *(Verified 2026-05-25: both `SUPABASE_URL` and `SUPABASE_KEY` present as `secret_text`.)*

**Edge case — first `secret put` before first `deploy`:** Wrangler will offer to create the Worker so the secret has somewhere to live. Accept; this creates an empty placeholder Worker that the first real deploy replaces. No traffic impact.

**Done when:** `wrangler secret list` shows both secrets. *(Phase 4 complete 2026-05-25.)*

---

## Phase 5 — First production deploy (~10 min, manual approval)

This is the gated mutation. The agent prepares everything; the user runs `wrangler deploy`.

- [x] Agent runs `npm run build` and confirms `dist/_worker.js/index.js` and `dist/` static assets exist. *(Done 2026-05-26: produced `dist/server/entry.mjs` + `dist/server/wrangler.json` + `dist/client/*` per the Phase 1 layout-divergence note; build green in 48.61s.)*
- [x] Agent runs `npx wrangler deploy --dry-run --outdir=dist-dryrun` to validate the bundle without uploading (this writes to a temp dir and reports the bundle size — useful sanity check). Delete `dist-dryrun/` afterward. *(Done 2026-05-26: bundle 1910.70 KiB / 390.68 KiB gzip, 21 modules, bindings `SESSION`/`IMAGES`/`ASSETS` resolved. Heaviest chunks: `worker-entry` 803 KiB, `supabase` 706 KiB. `dist-dryrun/` deleted.)*
- [x] **User runs** `npx wrangler deploy`. Output shows the deployed URL: `https://mind-tutor.<account-subdomain>.workers.dev`. *(Done 2026-05-26: `Deployed mind-tutor triggers (5.56 sec)` → `https://mind-tutor.konporeba.workers.dev`, version ID `e2c8062c-3301-4e10-ab22-792bb16968fe`.)*
- [x] User opens the URL in a browser; verify: *(All confirmed 2026-05-26 by user: signed in successfully on the live URL. `/auth/signin` form renders per agent-side fetch; sign-in round-trip and `/dashboard` access both worked in the browser.)*
  - [x] `/` loads (static landing).
  - [x] `/auth/signin` form renders.
  - [x] Sign-in flow round-trips (POST `/api/auth/signin` → redirect → `/dashboard`).
  - [x] `/dashboard` is protected (logged-out user redirects back to `/auth/signin`).

**Edge case — opaque 500 on first request:** the most common causes are (1) missing `nodejs_compat` flag (already set), (2) Supabase URL/key wrong (re-run `wrangler secret put`), or (3) cold-start exceeding the free-tier 10 ms CPU on the SSR + Supabase auth roundtrip. For #3: stream logs with `npx wrangler tail mind-tutor` while reproducing the request; look for `Worker exceeded CPU time limit`. If it appears, upgrade to the $5/mo paid plan — that's the threshold the infra plan called out.

**Edge case — Supabase cookies dropped between requests:** if the user signs in and is immediately logged out on the next navigation, this is the Workers `Headers.append` / `Set-Cookie` issue from the infra plan. Confirm `src/lib/supabase.ts` is using `AstroCookies.set` (per-cookie) rather than appending a raw `Set-Cookie` string. The current code does the right thing, but a regression here is the highest-likelihood bug post-deploy.

**Done when:** authenticated dashboard renders on the `workers.dev` URL.

---

## Phase 6 — GitHub Actions auto-deploy on merge to `master` (~15 min) — **DEFERRED**

> Deferred by user 2026-05-25. Manual `wrangler deploy` runs locally for now. Re-enter this phase (and the deferred items in Phase 3) when CI auto-deploy is wanted.


CI today (`.github/workflows/ci.yml`) only builds. Add a deploy job that runs after `ci` succeeds, gated on the `master` branch.

- [ ] Edit `.github/workflows/ci.yml` (or split into a new `deploy.yml` — keeping it in one file is fine for a single deploy target):
  - Add a `deploy` job that `needs: ci`, runs only `if: github.ref == 'refs/heads/master' && github.event_name == 'push'`.
  - Steps: checkout, setup Node 22, `npm ci`, `npm run build`, then `cloudflare/wrangler-action@v3` with `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}` and `accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}` and `command: deploy`.
  - The action does **not** automatically run `astro build` — the build step must run before the action, and the action just invokes `wrangler deploy`.
- [ ] Pin the action by tag (`@v3`) and document in the workflow that bumping it requires re-reading the changelog (infra plan risk: `@astrojs/cloudflare` and `wrangler-action` both iterate fast).
- [ ] **Verify** by pushing a no-op commit to a branch, opening a PR, merging, watching the deploy job in the Actions tab.

**Edge case — secrets exposed in PR previews:** the current workflow has `pull_request` triggers. Fork PRs do NOT get access to repo secrets (GitHub default), which means a fork PR's build job will fail at the `npm run build` step that needs `SUPABASE_URL`. That's fine — fork contributions need a maintainer to push the branch into the upstream repo to get a real build. Do **not** switch to `pull_request_target` to fix this; that pattern leaks secrets to attacker-controlled code.

**Edge case — deploy succeeds but old version stays live:** Cloudflare Workers deploys are atomic and propagate in seconds. If you see stale output, it's almost certainly browser cache or a CDN-cached asset. Hard-refresh first; if still wrong, check `npx wrangler deployments list mind-tutor` for the actual latest version ID.

**Done when:** a merge to `master` auto-deploys and the change is live on the `workers.dev` URL within ~2 minutes.

---

## Phase 7 — Cloudflare MCP servers (Observability + Bindings) (~10 min)

Wires structured agent access to runtime state. Both servers run remotely via `mcp-remote` and re-prompt for OAuth on each new machine (documented friction, not a bug).

- [x] Use the `update-config` skill (or edit `.claude/settings.local.json` by hand) to add two MCP servers:
  ```jsonc
  {
    "mcpServers": {
      "cloudflare-observability": {
        "command": "npx",
        "args": ["mcp-remote", "https://observability.mcp.cloudflare.com/mcp"]
      },
      "cloudflare-bindings": {
        "command": "npx",
        "args": ["mcp-remote", "https://bindings.mcp.cloudflare.com/mcp"]
      }
    }
  }
  ```
  *(Done 2026-05-26. **Plan-path correction:** Claude Code's settings.json schema has no `mcpServers` property, so the literal write into `.claude/settings.local.json` would be silently ignored. The canonical Claude Code MCP entrypoint is `.mcp.json` at the project root, gated by `enabledMcpjsonServers` in settings. Final layout:*
  - `.mcp.json` (committed; the Cloudflare URLs are public so safe to share with future contributors) — holds the two `mcpServers` definitions exactly as shown above.
  - `.claude/settings.local.json` (now gitignored; new line added to `.gitignore`) — holds `{"enabledMcpjsonServers": ["cloudflare-observability", "cloudflare-bindings"]}` so the harness auto-approves them on load.
  *Verified with `claude mcp list`: both servers are discovered (status `✗ Failed to connect` is the expected pre-OAuth state — the handshake fires on first tool call after Claude Code reload, per the next sub-task).)*
- [x] Restart Claude Code; first tool call to either server triggers a browser OAuth handshake — complete it once per machine. *(Done 2026-05-26: both servers loaded in this session and tool calls succeeded without OAuth prompts — handshake was completed in the prior session.)*
- [x] Verify by asking the agent to "list recent logs for mind-tutor" (Observability) and "list bindings on mind-tutor" (Bindings). *(Verified 2026-05-26 with `set_active_account` → `016342b5c7cf5429f151e7773cf26c44` on both servers. Observability returned 5 most-recent `mind-tutor` fetch events from the last 24h (all `outcome: ok`, all version `e2c8062c-3301-4e10-ab22-792bb16968fe`, CPU 2–7 ms, wall 3–137 ms) covering `/`, `/dashboard`, `/auth/signin`, `/auth/signup`, `POST /api/auth/signout`. Bindings returned the Worker record: `name: mind-tutor`, id `9f4eff4795d44c20a52ad654419a49e6`.)*

**Documentation TODO (deferred):** the OAuth re-prompt friction will surprise new contributors. Add a 3-line "MCP first-run" note to `context/deployment/deploy-plan.md` (created in Phase 8) so it's not mistaken for a broken setup.

**Done when:** both MCP servers respond to a structured query about the deployed Worker. *(Phase 7 complete 2026-05-26.)*

---

## Phase 8 — Write `context/deployment/deploy-plan.md` (~10 min)

The infra plan calls this out as the audit artifact that downstream skills consume. Write it after the deploy works, not before — so it documents what actually happened, not what was supposed to.

- [x] Create `X:\MindTutor\context\deployment\` directory. *(Already existed — `deployment-plan.md` lives here.)*
- [x] Write `deploy-plan.md` covering: *(Done 2026-05-26 — file at `context/deployment/deploy-plan.md`. Covers all listed sections plus a Quick-reference command table and a "What's not deployed" carry-forward list.)*
  - **Canonical deploy command:** `npx wrangler deploy` (locally) / `cloudflare/wrangler-action@v3` with `command: deploy` (CI). Explicit: **never** `wrangler pages deploy`.
  - **Secrets:** list of secret names (`SUPABASE_URL`, `SUPABASE_KEY`), where they live (Workers Secrets Store via `wrangler secret put`), how to rotate (`wrangler secret put <NAME>` again — idempotent overwrite, zero downtime).
  - **Rollback:** `npx wrangler rollback` (previous version) or `npx wrangler rollback <deployment-id>` (specific). Caveat: paired Supabase migrations need a manual down-migration first.
  - **Approval gates:** `wrangler deploy` to prod, `wrangler secret put` on a primary secret, `supabase db push` to prod project — all require user invocation, not agent invocation.
  - **MCP first-run note:** browser OAuth re-prompt on each new machine is expected.
  - **Free-tier watch:** flag the 10 ms CPU ceiling; if `Worker exceeded CPU time limit` appears in `wrangler tail`, upgrade to the $5/mo paid plan.
  - **Pages-deprecation reminder:** Pages is soft-deprecated for new projects; the agent must not run `wrangler pages deploy` even if old tutorials suggest it.

**Done when:** `context/deployment/deploy-plan.md` exists and reads cleanly as an onboarding doc.

---

## Phase 9 — Commit & verify end-to-end (~5 min)

- [x] Stage and commit the changes from Phases 1, 2, 6, 8: `wrangler.jsonc` (rename), `package.json` (engines field), `.dev.vars.example`, `.github/workflows/ci.yml` (deploy job), `context/deployment/deploy-plan.md`. *(Done 2026-05-26 as commit `d897a01` "Deploy mind-tutor to Cloudflare Workers, wire Cloudflare MCP". Phase 6's `.github/workflows/ci.yml` deploy-job edit was skipped since Phase 6 is deferred; commit also picked up `.gitignore` (settings.local.json exclusion) and `.mcp.json` (the MCP server defs, since the plan's literal `.claude/settings.local.json` location wouldn't be read by Claude Code — see Phase 7 correction note).)*
- [x] Push to `master`; watch the CI deploy job complete; verify the live URL still serves the authenticated dashboard. *(Pushed 2026-05-26: `2911647..d897a01 master -> master`. CI auto-deploy job is deferred with Phase 6 so there's no auto-deploy run to watch; existing CI build workflow runs on push but doesn't deploy. Live URL still serves the authenticated dashboard — re-verified during the tail step below.)*
- [x] Stream logs with `npx wrangler tail mind-tutor` for 60 seconds while clicking through the dashboard to confirm no `Worker exceeded CPU time limit` warnings. *(Done 2026-05-26: captured 8 requests in ~60s — full auth cycle (`/auth/signin` → POST signin → `/` → `/dashboard` → POST signout → `/` → `/auth/signin` → `/auth/signup`). Every line reported status `Ok`. Zero CPU-limit warnings, zero 5xx, zero errors. Free-tier CPU budget comfortably surviving the normal session shape.)*

**Done when:** the merge auto-deploy is green and the live URL behaves identically to local dev. *(Phase 9 met by manual deploy + post-push tail verification; the merge-auto-deploy half travels with the deferred Phase 6.)*

---

## Verification checklist (end-to-end)

- [x] `npx wrangler whoami` returns the correct account. *(Phase 3, 2026-05-25.)*
- [x] `npx wrangler secret list` shows `SUPABASE_URL` and `SUPABASE_KEY`. *(Phase 4, 2026-05-25.)*
- [x] `https://mind-tutor.<account>.workers.dev/` loads. *(Phase 5, 2026-05-26 → `https://mind-tutor.konporeba.workers.dev`.)*
- [x] `/auth/signup` → `/auth/signin` → `/dashboard` flow works on the live URL. *(Phase 5, 2026-05-26.)*
- [x] `/dashboard` redirects unauthenticated requests to `/auth/signin`. *(Phase 5, 2026-05-26.)*
- [ ] CI deploy job runs on merge to `master` and finishes in <2 min. *(Travels with deferred Phase 6.)*
- [x] `npx wrangler tail mind-tutor` shows no CPU-limit warnings during a normal session. *(Phase 9, 2026-05-26; re-confirmed via Observability MCP 2026-05-26 — last 24h CPU 2–7 ms, no `Worker exceeded CPU time limit` events.)*
- [x] Both Cloudflare MCP servers respond to structured queries. *(Phase 7, 2026-05-26.)*

## Critical files touched

- `X:\MindTutor\wrangler.jsonc` — Worker name
- `X:\MindTutor\package.json` — `engines.node`
- `X:\MindTutor\.dev.vars.example` — new
- `X:\MindTutor\.github\workflows\ci.yml` — deploy job
- `X:\MindTutor\context\deployment\deploy-plan.md` — new
- `X:\MindTutor\.mcp.json` — MCP servers (committed; public Cloudflare URLs)
- `X:\MindTutor\.claude\settings.local.json` — `enabledMcpjsonServers` allowlist (gitignored)
- `X:\MindTutor\.gitignore` — new line excluding `.claude/settings.local.json`

## Risks carried forward (not blocking deploy, watch for them)

- **Free-tier CPU ceiling** — opaque 500s likely under combined SSR + Supabase load. Mitigation: enable paid plan on first sighting.
- **Secret-scanning pre-commit hook** — infra plan recommends one; deferred. Add when first secret-shaped string ends up staged.
- **PDF parsing on Workers** — when upload feature lands, route via R2 + Queue, never parse in the request handler. Don't retrofit; design it in.
- **`@astrojs/cloudflare` v13→v14 break** — pin tightly (`~13.5.0`) and require manual review on adapter upgrades.
