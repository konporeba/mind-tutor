---
bootstrapped_at: 2026-05-24T18:07:07Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: mind-tutor
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md` (frontmatter + body):

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: mind-tutor
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

Solo learner-developer shipping MindTutor in 5 weeks after-hours, with a hard deadline of 2026-07-05. The product is auth-gated, LLM-driven, and persists per-user materials/sessions — it needs auth + Postgres + file storage on day one. The recommended default for `(web, js)`, 10x-astro-starter, bundles Astro 6 + React 19 + TypeScript + Tailwind 4 + Supabase (auth, Postgres, storage) + Cloudflare Pages/Workers and clears all four agent-friendly gates. Bootstrapper confidence is first-class — scaffolding is registered with a valid CLI; expect occasional manual steps but no roadblocks. Auth and AI feature flags are set; payments, realtime, and background jobs are out of scope per PRD non-goals (no premium tier, single-sitting sessions, no spaced-repetition). Deployment lands on Cloudflare Pages — the card's first default and the cheapest free-tier path for a medium-scale MVP. GitHub Actions with auto-deploy-on-merge is the solo-shipper default. Edge-runtime constraints around long-running PDF parsing inside a Worker request are a known gotcha worth planning for — do parsing on upload via a queue or an external worker if 20 MB PDFs trip the limit.

## Pre-scaffold verification

| Signal      | Value                                                     | Severity | Notes                                                              |
| ----------- | --------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| npm package | not run                                                   | n/a      | cmd_template starts with `git clone`; no `create-*` CLI to look up |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh    | from card.docs_url; 7 days old at scaffold time                    |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 20 (`.env.example`, `.github/`, `.gitignore`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `astro.config.mjs`, `CLAUDE.md` → sidelined, `components.json`, `eslint.config.js`, `node_modules/`, `package.json`, `package-lock.json`, `public/`, `README.md`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`)
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold` (cwd already had a `CLAUDE.md` — the 10xDevs lesson 1+2 instructions; the scaffold's CLAUDE.md is preserved as `.scaffold` sibling for diff review)
**.gitignore handling**: moved silently (no prior `.gitignore` in cwd)
**.bootstrap-scaffold cleanup**: deleted (cloned `.git/` removed before move-up per git-clone strategy; temp dir then removed)
**Preserved in cwd (matrix protected)**: `context/`, `.claude/`, `CLAUDE.md`, `mindtutor-project-notes.md`

Install warnings (informational): `@babel/plugin-proposal-private-methods@7.18.6` (deprecated, superseded by `@babel/plugin-transform-private-methods`), `node-domexception@1.0.0` (deprecated, use native `DOMException`). 773 packages added, 308 looking for funding.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW (10 total across 895 dependencies: 449 prod, 316 dev, 131 optional)
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0. The single HIGH is transitive; 2 of the 9 MODERATEs are direct (`@astrojs/check`, `wrangler`).

#### CRITICAL findings

None.

#### HIGH findings

- **`devalue`** (range `5.6.3 - 5.8.0`) — transitive. Advisory: _Svelte devalue: DoS via sparse array deserialization_ (GHSA-77vg-94rm-hx3p, CWE-770, CVSS 7.5). Fix available via dependency update (`npm audit fix`).

#### MODERATE findings

- **`@astrojs/check`** (range `>=0.9.3`) — DIRECT. Via `@astrojs/language-server`. Fix available but requires SemVer-major downgrade to `0.9.2` (breaking change).
- **`@astrojs/language-server`** (range `>=2.14.0`) — transitive (via `volar-service-yaml`). Effects `@astrojs/check`. Fix via the `@astrojs/check` major bump above.
- **`@cloudflare/vite-plugin`** (range `0.0.7 - 1.37.2`) — transitive (via `miniflare`, `wrangler`, `ws`). Fix available.
- **`miniflare`** — transitive (via `ws`). Effects `@cloudflare/vite-plugin`, `wrangler`. Fix available.
- **`volar-service-yaml`** — transitive (via `yaml-language-server`). Effects `@astrojs/language-server`. Fix via `@astrojs/check` major bump.
- **`wrangler`** (range `3.108.0 - 4.93.0`) — DIRECT. Via `miniflare`. Effects `@cloudflare/vite-plugin`. Fix available.
- **`ws`** (range `8.0.0 - 8.20.0`) — transitive. Advisory: _Uninitialized memory disclosure_ (GHSA-58qx-3vcg-4xpx, CWE-908, CVSS 4.4). Fix available.
- **`yaml`** (range `2.0.0 - 2.8.2`) — transitive (via `yaml-language-server`). Advisory: _Stack Overflow via deeply nested YAML collections_ (GHSA-48c2-rrv3-qjmp, CWE-674, CVSS 4.3). Fix via `@astrojs/check` major bump.
- **`yaml-language-server`** — transitive (via `yaml`). Effects `volar-service-yaml`. Fix via `@astrojs/check` major bump.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | true                 |
| has_background_jobs     | false                |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep. Here: `CLAUDE.md.scaffold` (starter's agent-context file) vs `CLAUDE.md` (your existing 10xDevs lesson 1+2 instructions). A common move is to merge the starter's repo/runtime conventions into your file.
- Address audit findings per your project's risk tolerance — start with `npm audit fix` for non-breaking fixes; the `@astrojs/check` 0.9.3 → 0.9.2 downgrade is SemVer-major so review before applying.
- Copy `.env.example` to `.env` and fill in Supabase + Cloudflare credentials before `npm run dev`.
