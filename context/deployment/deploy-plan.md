# MindTutor Deploy Plan

Onboarding doc for the live Cloudflare Workers deployment. The chronological execution log lives in `deployment-plan.md` next door; this file is the canonical reference for "how do we deploy / rotate / roll back" once someone is past Phase 0.

**Live URL:** https://mind-tutor.konporeba.workers.dev
**Worker name:** `mind-tutor` (Cloudflare account `Konporeba@gmail.com's Account` — `016342b5c7cf5429f151e7773cf26c44`)
**First deploy:** 2026-05-26, version `e2c8062c-3301-4e10-ab22-792bb16968fe`

---

## Canonical deploy command

```powershell
npx wrangler deploy
```

That's it. Locally, from the repo root, after `npm run build`. The Astro adapter writes `dist/server/entry.mjs` + `dist/server/wrangler.json` and `wrangler deploy` consumes the generated `wrangler.json` (not the root `wrangler.jsonc` literally — see the layout-divergence note in `deployment-plan.md` Phase 1).

CI auto-deploy is **deferred** (Phase 6). When picked up, the CI side uses `cloudflare/wrangler-action@v3` with `command: deploy`, fed by `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets. The action does **not** run `astro build` itself — the build step must precede it.

### Never run

- `wrangler pages deploy` — Pages is soft-deprecated for new projects. MindTutor is a Workers app. Old tutorials still suggest it; ignore them.
- `wrangler deploy --env production` (or any `--env`) — there is no `[env.*]` block in `wrangler.jsonc` because there's only one environment. Adding `--env` errors out.

---

## Secrets

| Name | Where | Used by | How to read it |
|---|---|---|---|
| `SUPABASE_URL` | Workers Secrets Store (prod) + `.dev.vars` (local) | `src/lib/supabase.ts` via `astro:env/server` | `wrangler secret list` (names only) |
| `SUPABASE_KEY` | Workers Secrets Store (prod) + `.dev.vars` (local) | `src/lib/supabase.ts` via `astro:env/server` | same |

### Rotate

```powershell
npx wrangler secret put SUPABASE_URL    # prompts for value
npx wrangler secret put SUPABASE_KEY
```

Idempotent overwrite; zero downtime. The new value applies on the next request (no redeploy needed). Update `.dev.vars` locally to match if the rotation should be reflected in dev.

### Do not

- Add either secret to the `vars` block in `wrangler.jsonc`. That block is plaintext and committed to git.
- Commit `.dev.vars`. It's in `.gitignore` (line 21); only `.dev.vars.example` is checked in.

---

## Rollback

Cloudflare Workers keeps prior versions and lets you point traffic back at any of them.

```powershell
npx wrangler rollback                            # one step back
npx wrangler rollback <deployment-id>            # specific version
npx wrangler deployments list mind-tutor         # find a version id
```

Rollback is instant — atomic flip on Cloudflare's edge.

### Caveat: paired Supabase migrations

If the rollback target predates a Supabase schema change that's already applied to the prod project, the older code may break against the newer schema. Order of operations for a rollback that crosses a schema boundary:

1. Apply the matching Supabase down-migration first (manual: `supabase db reset` is destructive — write a real down-migration).
2. *Then* `wrangler rollback`.

This is the same constraint that forward-deploys have in reverse — schema and code are coupled.

---

## Approval gates (human-only operations)

These never run inside an agent session, even if the agent can construct the command. The agent prepares; the user runs.

- `npx wrangler deploy` — mutates the prod Worker.
- `npx wrangler secret put <NAME>` — writes a primary secret (anything tied to Supabase auth, third-party APIs, etc.).
- `npx supabase db push` (or any production migration) — mutates the prod database.
- `npx wrangler rollback` and `wrangler delete` — also gated; rollback is reversible but should still be a conscious choice.

The agent may freely run: `wrangler whoami`, `wrangler secret list`, `wrangler deployments list`, `wrangler tail`, `wrangler deploy --dry-run`. Anything read-only or hypothetical.

---

## Observability

Two paths:

**CLI (always available):**
```powershell
npx wrangler tail mind-tutor          # live log stream
```

**MCP (after one-time OAuth — see next section):**
- `cloudflare-observability` MCP server → structured queries against Workers Logs.
- `cloudflare-bindings` MCP server → list/inspect bindings (KV, Secrets, etc.) on `mind-tutor`.

Free-tier observability is enabled in `wrangler.jsonc` (`observability.enabled: true`). No paid plan needed for log streaming.

---

## MCP first-run note

`.mcp.json` defines two remote MCP servers (`cloudflare-observability`, `cloudflare-bindings`). `.claude/settings.local.json` allowlists them.

**On each new machine** — first tool call to either server triggers a browser OAuth handshake via `mcp-remote`. This is expected, not a broken setup. Complete the OAuth once and the server stays connected for the session. The token is cached per-machine; subsequent sessions reuse it.

If `claude mcp list` shows `✗ Failed to connect` after a fresh checkout, that's the pre-OAuth state. Trigger any agent action that calls one of the servers and the browser will open.

---

## Free-tier CPU watch

MindTutor runs on Cloudflare's **free tier**. The relevant ceiling is the 10 ms per-request CPU budget. SSR + a Supabase auth round-trip on cold start can flirt with that limit.

**Symptom:** Opaque 500s from the live URL under any kind of sustained traffic, especially first request after a quiet period.

**Diagnosis:**
```powershell
npx wrangler tail mind-tutor
```
Reproduce the request while tailing. Look for `Worker exceeded CPU time limit`.

**Fix:** Upgrade to the **$5/mo paid plan** (Workers Paid). That raises the CPU ceiling to 50 ms and unlocks higher limits across the board. The $5 is the threshold the infra plan called out — don't pre-upgrade, but don't hesitate either once you see the symptom.

---

## What's *not* deployed (carried forward)

- **R2 / Queues** — deferred until the PDF-upload feature lands. When it does, route uploads via R2 + Queue; never parse PDFs in the request handler.
- **Staging Worker** — single prod Worker only for MVP. A staging environment is the natural follow-up once the deploy cadence justifies it.
- **Custom domain** — using the `workers.dev` subdomain for MVP. Add a custom domain when the URL goes public-facing.
- **CI auto-deploy** — Phase 6 of `deployment-plan.md`, deferred. Manual `wrangler deploy` from a developer machine for now.
- **Secret-scanning pre-commit hook** — infra plan recommends one; deferred. Add when the first secret-shaped string ends up staged.

---

## Quick reference

| Task | Command |
|---|---|
| First deploy | `npm run build && npx wrangler deploy` |
| Subsequent deploy | `npx wrangler deploy` (build runs implicitly via the adapter's hook) |
| Dry-run (validate bundle) | `npx wrangler deploy --dry-run --outdir=dist-dryrun` |
| Stream live logs | `npx wrangler tail mind-tutor` |
| List secret names | `npx wrangler secret list` |
| Rotate a secret | `npx wrangler secret put <NAME>` |
| List versions | `npx wrangler deployments list mind-tutor` |
| Rollback | `npx wrangler rollback [version-id]` |
| Verify auth | `npx wrangler whoami` |
