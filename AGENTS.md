# Repository Guidelines

Astro 6 SSR app with React 19 islands, Tailwind 4, and Supabase auth. Deployed to Cloudflare Workers via `@astrojs/cloudflare`. Node 22.14.0 (pinned in `.nvmrc`).

## Tripwires

- **Every API route must `export const prerender = false`.** Pages default to SSR; endpoints that forget this break under the Cloudflare adapter. See `@src/pages/api/auth/signin.ts`.
- **No Next.js directives.** This is Astro, not Next — do not write `"use client"` / `"use server"`. React components render as islands declared in `.astro` files (`client:load`, `client:visible`).
- **`SUPABASE_URL` / `SUPABASE_KEY` are server-only secrets.** Read via `astro:env/server` only; the schema in `@astro.config.mjs` enforces it. Never import them into client code.
- **New Supabase tables require RLS** plus granular per-operation, per-role policies in the same migration.

## Project Structure

- `src/pages/` — Astro routes; `src/pages/api/` — endpoints (must set `prerender = false`).
- `src/components/` — Astro for static, React `.tsx` for interactive; hooks live in `src/components/hooks/`.
- `src/components/ui/` — shadcn/ui (`new-york` variant, see `@components.json`).
- `src/lib/` — services and helpers; extracted business logic under `src/lib/services/`.
- `src/middleware.ts` — auth resolution and `PROTECTED_ROUTES` enforcement.
- `src/types.ts` — shared entity and DTO types.
- `supabase/migrations/` — timestamped SQL named `YYYYMMDDHHmmss_short_description.sql`.

## Build, Test, and Development Commands

- `npm run dev` — Cloudflare workerd dev server.
- `npm run build` — production SSR build.
- `npm run preview` — preview the built worker.
- `npm run lint` / `npm run lint:fix` — ESLint, type-checked.
- `npm run format` — Prettier across the repo.
- `npx supabase start` — local Supabase stack (Docker required).
- `npx wrangler deploy` — deploy to Cloudflare.

## Coding Style & Naming Conventions

- TypeScript strict; ESLint runs `strictTypeChecked` + `stylisticTypeChecked` plus `react-compiler` as an error. Config in `@eslint.config.js`.
- Path alias `@/*` → `./src/*` (`@tsconfig.json`). Use it instead of long relative paths.
- Merge Tailwind classes with `cn()` from `@/lib/utils` — do not concatenate class strings manually.
- Validate API input with `zod`; export uppercase `GET` / `POST` handlers.
- Install new shadcn components with `npx shadcn@latest add <name>`.

## Testing & CI

No unit-test runner is wired up yet. CI (`@.github/workflows/ci.yml`) runs `npx astro sync`, `npm run lint`, then `npm run build` against `master`; repo secrets `SUPABASE_URL` and `SUPABASE_KEY` must be set. Pre-commit hooks (husky + lint-staged) run `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}` — fix issues; do not bypass with `--no-verify`.

## Commit & Pull Request Guidelines

History is shallow and no convention is established yet. Keep commit subjects in the imperative mood, under ~72 chars. PRs must pass the CI gate above and target `master`. Reference the migration filename in the PR description when touching `supabase/migrations/`.
