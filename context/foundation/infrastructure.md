---
project: mind-tutor
researched_at: 2026-05-25
recommended_platform: cloudflare-workers
runner_up: vercel
context_type: mvp
tech_stack:
  language: typescript
  framework: astro-6
  runtime: cloudflare-workers
  database: supabase-postgres
---

## Recommendation

**Deploy on Cloudflare Workers (Workers Static Assets, not Pages).**

Cloudflare is the only researched platform that Passes all five agent-friendly criteria, and the existing scaffold is already wired to it — `@astrojs/cloudflare` ^13.5.0, `workerd` dev runtime, `astro:env/server` secret bindings, `wrangler.jsonc` checked in. The 100 MB request body limit means 20 MB PDF uploads cross the request boundary directly (no signed-URL workaround required, as Vercel's 4.5 MB and Netlify's 6 MB caps would force). Cost is $0 free tier for development and $5/mo paid for production-realistic CPU headroom. The thirteen GA Cloudflare MCP servers (docs, Workers Bindings, Workers Observability) give Claude Code structured access to live state without parsing CLI output. Soft-deprecated `wrangler pages deploy` is explicitly out — canonical command is `wrangler deploy`.

## Platform Comparison

Scored against the five criteria in `references/agent-friendly-criteria.md`. Hard filters: none triggered — the PRD calls out no realtime, no background jobs, request/response only, so the persistent-connection filter doesn't drop anyone. All six platforms have a working Astro adapter.

| Platform               | CLI-first                         | Managed/SLS | Agent docs           | Stable deploy | MCP                         | Total   |
| ---------------------- | --------------------------------- | ----------- | -------------------- | ------------- | --------------------------- | ------- |
| **Cloudflare Workers** | Pass                              | Pass        | Pass                 | Pass          | **Pass** (13 GA)            | **5/5** |
| **Vercel**             | Pass                              | Pass        | Pass                 | Pass          | Partial (Beta, read-only)   | 4.5/5   |
| **Netlify**            | Pass                              | Pass        | Pass                 | Pass          | **Pass** (GA Jun 2025)      | **5/5** |
| **Fly.io**             | Pass                              | Pass        | Fail (no `llms.txt`) | Pass          | Partial (experimental)      | 3.5/5   |
| **Railway**            | Partial (rollback dashboard-only) | Pass        | Pass                 | Pass          | Partial (beta)              | 4/5     |
| **Render**             | Pass                              | Pass        | Fail (no `llms.txt`) | Pass          | Partial (no deploy trigger) | 3.5/5   |

After soft-weighting (DX prioritized per interview Q2; no familiarity bias per Q3; single-region acceptable per Q4; Supabase stays per Q5) and the tech-stack alignment tilt (already adapter-pinned to Cloudflare), the leader is Cloudflare. Netlify ties on raw score but loses the alignment tilt and the body-cap comparison.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Tech-stack alignment is decisive: `@astrojs/cloudflare` ^13.5.0 is already installed, `astro.config.mjs` declares the adapter, `wrangler.jsonc` exists, and the `env.schema` block is using `envField` with `context: "server", access: "secret"` which maps cleanly to Workers bindings. Switching to anything else costs a half-day of adapter swap and env-access rewrites. Body cap (100 MB) is large enough that PDF uploads don't require a Supabase signed-URL detour for MVP. MCP coverage is best-in-class (13 servers GA: Documentation, Workers Bindings, Workers Observability, AI Gateway, Browser Rendering, etc.). Cost is the lowest of the shortlist: $0 free or $5/mo paid Workers plan. The real cliff is the 30 s CPU limit on dense PDFs — mitigated in the risk register below.

#### 2. Vercel (Runner-up)

Passes 4/5 criteria; loses only on MCP (Public Beta, read-only as of Feb 2026). Hobby tier free for non-commercial projects (MindTutor as a portfolio/cohort build qualifies). Adapter swap to `@astrojs/vercel` is mechanical but real (~1 evening). The 4.5 MB function body cap is the load-bearing constraint: 20 MB PDF uploads must go directly to Supabase Storage via signed URL, with the Vercel Function receiving only the storage key. That architecture is defensible (it's also what Cloudflare would need at higher PDF sizes), but it's mandatory from day one on Vercel — not optional.

#### 3. Netlify

Ties Cloudflare at 5/5 (official MCP server went GA in June 2025; `llms.txt` published). Same forcing function as Vercel: 6 MB body cap means the signed-URL upload pattern is mandatory. Credit-based pricing (introduced Sep 2025) is harder to reason about for a solo dev — 1 deploy = 15 credits, 1 GB bandwidth = 10 credits, with 300 credits free per month. Workable but cognitively expensive vs. Cloudflare's flat $5/mo. Same adapter swap cost as Vercel.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **30 s CPU limit on Worker requests is a real cliff for PDF parsing.** Pure-JS parsers (`unpdf`, `pdfjs-serverless`) work, but a 20 MB scanned PDF with embedded images can exceed CPU time even on the paid plan. First test user with a dense academic PDF could trigger an opaque 500. CPU time ≠ wall-clock time — metered per request.
2. **`@astrojs/cloudflare` v13 removed `Astro.locals.runtime`.** Env now flows through `import { env } from 'cloudflare:workers'`. Any tutorial / SO answer from before mid-2025 is subtly wrong and AI assistants will confidently quote the deprecated API.
3. **Pages-vs-Workers split is a live trap.** `context/foundation/tech-stack.md` literally says `deployment_target: cloudflare-pages`, but Pages is soft-deprecated for new projects and `@astrojs/cloudflare` officially targets Workers. Following the older Pages path produces a deploy that exists but ships behind the new feature surface and needs migration later.
4. **Supabase + Workers cookie handling has edge cases.** `@supabase/ssr` works, but Workers `Headers.append` and `Set-Cookie` array semantics differ subtly from Node. The "logged in on the first request, logged out on the second" class of bug is common and hard to reproduce locally because `wrangler dev` is not byte-exact with prod.
5. **No EU-only data residency guarantee on Workers paid tier.** Workers run at the nearest edge globally. Not a GDPR blocker for a learning app, but if data-residency promises are ever made, only Smart Placement + jurisdictional restrictions (beyond the $5 tier) can deliver them.

### Pre-Mortem — How This Could Fail

It's late November 2026. MindTutor shipped in week 6 (one week late), and the project has plateaued. The first real test user uploaded a 32-page lecture PDF with embedded figures in week 4. The Worker hit the 30 s CPU limit mid-parse, returned an opaque 500, and the user — already on their second attempt because the first session had been lost to a separate bug — abandoned. The fix was non-trivial: an R2 + Queue offload for parse-on-upload, two evenings of after-hours work, deadline missed. In week 5, an auth bug emerged where session cookies were being overwritten on parallel API requests — a Workers-specific `Headers` API quirk that surfaced only under load. The solo dev spent three days narrowing it because `wrangler dev` couldn't reproduce it. By month three, the developer had quietly migrated to Fly.io to escape Workers' constraints — another week of redeployment work, original infra decision invalidated. The pattern: edge-runtime constraints around PDF parsing weren't theoretical — they were the actual failure mode, and the tech-stack rationale even flagged them. The recovery: bake the R2-offload path into the MVP architecture from day one, not as a fix after first failure.

### Unknown Unknowns

- **`wrangler dev` is not byte-exact with prod.** Despite both running `workerd`, cache behavior, env binding hydration, and timer accuracy differ. Bugs reproducible only in prod are common — budget time for "deploy to a staging Worker to reproduce."
- **Cloudflare MCP servers all require remote OAuth** (`mcp-remote https://<name>.mcp.cloudflare.com/mcp`). Every Claude Code session on a new machine has a browser-OAuth handshake — not silent like API tokens. Small but recurring friction.
- **Free-tier 10 ms CPU is too tight for SSR + Supabase auth roundtrip.** Idle dashboard requests typically burn 15–40 ms CPU. Treat $5/mo paid Workers plan as the real floor from day one — not a "scale later" decision.
- **The Workers Secrets Store is Workers-only** (not Pages). Following old Pages tutorials and putting secrets in a `.env`-style dashboard surface breaks silent secret rotation. Use Secrets Store from day one even though it adds 10 min of setup.
- **`@astrojs/cloudflare` is on a fast-iteration cadence** (v13 removed APIs that v12 had). Pin the adapter version in `package.json` — accepting a Renovate PR without reading the changelog can break a deploy.

## Operational Story

- **Preview deploys**: Every PR to GitHub gets a Workers Preview URL via the Cloudflare GitHub integration (`cloudflare/wrangler-action@v3` in GitHub Actions). Preview URLs are public by default — if the materials or auth flow exposes anything sensitive, gate them with Cloudflare Access (free for up to 50 users). Fork PRs do not receive previews unless the `pull_request_target` event is wired with explicit secret scoping.
- **Secrets**: Production secrets (`SUPABASE_URL`, `SUPABASE_KEY`, `OPENAI_API_KEY` or equivalent LLM key) live in **Workers Secrets Store** (`wrangler secret put <NAME>`), not in `wrangler.jsonc` and not in the Pages dashboard. Local dev secrets go in `.dev.vars` (already gitignored per `CLAUDE.md`). GitHub Actions reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from repository secrets. Rotation: `wrangler secret put` is idempotent — overwrites trigger no downtime.
- **Rollback**: `wrangler rollback [deployment-id]` or `wrangler rollback` (rolls to the previous deploy). Time-to-revert: under 30 s. Caveat: Supabase migrations don't roll back automatically with the Worker — any DB change that landed alongside a deploy needs a paired down-migration before rollback, or the rolled-back Worker hits a schema it doesn't understand.
- **Approval**: An agent may run `wrangler deploy` to a non-production Worker name (preview / staging) unattended. Production deploys (`wrangler deploy` to the canonical Worker), `wrangler secret put` on a primary secret rotation, and any `supabase db push` to the production project require explicit human invocation — the user runs them or approves them in chat.
- **Logs**: Runtime logs via `wrangler tail [worker-name]` (live stream) or the Cloudflare Workers Observability MCP server (structured query: time range, log level, request URL). Pipeline logs via `gh run view <run-id> --log`. Both are read-only for the agent; nothing in this loop mutates state.

## Risk Register

| Risk                                                                         | Source                                         | Likelihood | Impact | Mitigation                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------- |
| 20 MB PDF parse exceeds 30 s Worker CPU limit                                | Devil's advocate, Pre-mortem, Research finding | M          | H      | From day one, route uploads directly to R2 (or Supabase Storage) and trigger parse via Queue → dedicated parser Worker. Don't parse in the request handler.  |
| `wrangler dev` doesn't reproduce prod auth/cookie bugs                       | Devil's advocate, Unknown unknowns             | M          | M      | Maintain a `mind-tutor-staging` Worker. Reproduce any auth bug there before debugging locally.                                                               |
| Old Pages tutorials lead the agent to `wrangler pages deploy`                | Devil's advocate, Research finding             | H          | M      | Lock the deploy command in `context/deployment/deploy-plan.md` as `wrangler deploy`. Add to CLAUDE.md: "Pages is deprecated for this project — use Workers." |
| `@astrojs/cloudflare` v13→v14 breaking change after Renovate auto-PR         | Unknown unknowns                               | M          | H      | Pin the adapter version exactly in `package.json` (already `^13.5.0` — consider `~13.5.0`). Require manual review on adapter upgrades.                       |
| Free-tier CPU limit (10 ms) silently throttles dashboard requests in staging | Unknown unknowns                               | H          | L      | Enable the paid Workers plan from day one. Document it in `context/deployment/deploy-plan.md`.                                                               |
| Supabase migration + Worker rollback skew                                    | Operational reasoning (deploy/rollback)        | L          | H      | For any deploy that includes a Supabase migration, write the down-migration in the same PR. Roll back DB first, then Worker.                                 |
| OAuth flow for Cloudflare MCP servers re-prompts on new machines             | Unknown unknowns                               | H          | L      | Accept the friction. Document MCP setup steps in `context/deployment/deploy-plan.md` so new contributors don't think it's broken.                            |
| Workers Secrets Store skipped in favor of `wrangler.jsonc` plaintext         | Unknown unknowns                               | M          | H      | Use `wrangler secret put` for every secret from day one. Pre-commit hook to refuse commits to `wrangler.jsonc` containing keys matching `\*\_KEY             | \*\_SECRET | \*\_TOKEN`. |
| EU-only data residency promised without infra support                        | Devil's advocate                               | L          | M      | Don't make residency claims in MVP marketing. If required later, evaluate Smart Placement + jurisdictional restrictions (paid feature).                      |

## Getting Started

The scaffold is already on the right path. These are the gaps to close, ordered.

1. **Reinterpret `deployment_target` in `tech-stack.md`.** It says `cloudflare-pages` but the canonical 2026 path is Workers. Update the field to `cloudflare-workers` in `context/foundation/tech-stack.md` (the Why-this-stack body needs no rewrite — Cloudflare/Supabase/Astro is still right).
2. **Confirm `wrangler.jsonc` targets a Worker, not a Pages project.** It should have `main` pointing to the Astro build output (e.g. `./dist/_worker.js/index.js`) and an `assets` block (`./dist`). The adapter v13 generates this on `astro build` — verify and commit.
3. **Set up Cloudflare account + API token.** Create a scoped API token: `Workers Scripts:Edit` for the MindTutor account, `Workers KV Storage:Edit` if KV is ever used, no DNS, no billing. Store as `CLOUDFLARE_API_TOKEN` in GitHub repository secrets alongside `CLOUDFLARE_ACCOUNT_ID`.
4. **Move secrets out of `.env` into Workers Secrets Store.** `wrangler secret put SUPABASE_URL && wrangler secret put SUPABASE_KEY`. Keep `.dev.vars` local-only.
5. **First deploy via Plan Mode.** Use the host's Plan Mode (`Shift+Tab` to cycle modes in Claude Code) with the prompt: _"Wykonajmy pierwsze wdrożenie w oparciu o `@infrastructure.md`, zgodnie ze stackiem z `@tech-stack.md`."_ The agent emits `context/deployment/deploy-plan.md`. Review, edit, approve, then execute.
6. **Wire `cloudflare/wrangler-action@v3` in `.github/workflows/`.** Auto-deploy on merge to `master` per the `auto-deploy-on-merge` hint in tech-stack.md. CI already runs lint + build per existing `ci.yml` — add a deploy job that runs after build, gated on `github.ref == 'refs/heads/master'`.

The deploy command — both locally and in CI — is `npx wrangler deploy`. Never `wrangler pages deploy`.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration (not applicable — Workers does not use containers).
- CI/CD pipeline setup (a GitHub Actions deploy job is mentioned in Getting Started as a next step, but its YAML is not specified here — it belongs in the deploy plan).
- Production-scale architecture: multi-region failover, dedicated Durable Objects fleet, SLA commitments, AI inference egress at >10k req/day.
- Long-term cost modeling beyond the MVP traffic envelope (10k–100k req/month, ~100 active learners).
- Mid-session resume infrastructure (explicit PRD non-goal — see `prd.md` Non-Goals).
