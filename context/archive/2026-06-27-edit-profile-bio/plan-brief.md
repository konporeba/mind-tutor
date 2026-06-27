# Edit Profile Bio — Plan Brief

> Full plan: `context/changes/edit-profile-bio/plan.md`

## What & Why

Let an already-onboarded learner edit their profile bio after onboarding. The bio (`profiles.bio`, ≤ 1000 chars) is captured once at onboarding and reused on every session to set tutoring depth/idiom (FR-006), but today there's no way to view or change it. This adds an edit form on `/account`.

## Starting Point

The `profiles` table, `bio` column, and `profiles_update_own` RLS policy already exist; the bio is written once at onboarding via LLM distillation (`api/onboarding/index.ts`). The `/account` page is a protected route that currently renders only `ChangePasswordForm` in a single card. A complete, directly reusable pattern exists in the password-change feature (island + form-POST endpoint).

## Desired End State

`/account` shows two cards: a "Your bio" editor (textarea pre-filled with the current bio + char counter) and the existing "Change password" card. Saving writes the raw trimmed text to `profiles.bio`, reloads the page, and shows a success banner on the bio card only. Blank submissions are rejected without clearing the stored bio.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Edit semantics | Save raw edited text | Matches "edit my text" mental model; no LLM latency/cost; user refines the distilled text directly | Plan |
| Empty bio | Require non-empty (min 1 after trim) | Bio is a load-bearing prompt ingredient every session; keep the onboarding invariant | Plan |
| Page layout | Second card, retitle page to "Account" | Clean separation, each form keeps its own submit + banners, minimal churn | Plan |
| Submit pattern | Form POST → redirect with status params | One consistent idiom on the page (mirrors change-password), least code | Plan |
| Status params | Namespaced `bioError`/`bioSuccess` | Avoid a bio save lighting up the password card's shared `error`/`success` banner | Plan |
| Verification | Lint/build + manual UI check | Matches how the password feature ships; no test-infra assumptions | Plan |

## Scope

**In scope:** new `POST /api/profiles/bio` endpoint; new `EditBioForm` island; `account.astro` restructure (fetch current bio, two cards, namespaced params).

**Out of scope:** DB migration / RLS change; re-distillation; clearing bio to empty; automated tests; shadcn Textarea install; onboarding-path or middleware changes; separate bio route.

## Architecture / Approach

Near-copy of the existing password-change feature. `account.astro` (server) fetches the current bio and renders two client islands. `EditBioForm` posts a form to `/api/profiles/bio`, which authenticates, validates (`z.string().trim().min(1).max(BIO_MAX)`), runs a PK-scoped `update` on `profiles`, and redirects with `bioSuccess`/`bioError`. RLS enforces ownership.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Bio update endpoint | `POST /api/profiles/bio` (auth, validate, update, namespaced redirect) | Param namespacing colliding with password banner |
| 2. Account page card + form | Server bio fetch + `EditBioForm` island, two-card layout | Pre-fill fetch / banner routing to the wrong card |

**Prerequisites:** None — schema, RLS, and reference patterns already exist.
**Estimated effort:** ~1 session across 2 small phases.

## Open Risks & Assumptions

- Assumes every `/account` visitor is onboarded (guaranteed by middleware), so the `profiles` row always exists → plain `update`, not `upsert`.
- Shared query-param namespace on `account.astro` is the one coupling to get right; namespacing the bio params resolves it without touching the password form.

## Success Criteria (Summary)

- A learner can edit and save their bio from `/account`, and the change persists.
- Blank submissions are rejected and never wipe the stored bio.
- The password card and bio card show their own success/error banners independently (no regression).
