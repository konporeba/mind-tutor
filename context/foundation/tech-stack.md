---
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
---

## Why this stack

Solo learner-developer shipping MindTutor in 5 weeks after-hours, with a hard
deadline of 2026-07-05. The product is auth-gated, LLM-driven, and persists
per-user materials/sessions — it needs auth + Postgres + file storage on day
one. The recommended default for `(web, js)`, 10x-astro-starter, bundles Astro 6
+ React 19 + TypeScript + Tailwind 4 + Supabase (auth, Postgres, storage) +
Cloudflare Pages/Workers and clears all four agent-friendly gates. Bootstrapper
confidence is first-class — scaffolding is registered with a valid CLI; expect
occasional manual steps but no roadblocks. Auth and AI feature flags are set;
payments, realtime, and background jobs are out of scope per PRD non-goals (no
premium tier, single-sitting sessions, no spaced-repetition). Deployment lands
on Cloudflare Pages — the card's first default and the cheapest free-tier path
for a medium-scale MVP. GitHub Actions with auto-deploy-on-merge is the
solo-shipper default. Edge-runtime constraints around long-running PDF parsing
inside a Worker request are a known gotcha worth planning for — do parsing on
upload via a queue or an external worker if 20 MB PDFs trip the limit.
