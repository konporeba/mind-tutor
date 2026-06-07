# S-01 First Grounded Session — Verification Checklist

Repeatable manual + automated proof of the PRD success criteria for this slice.

## Prerequisites

- Local Supabase running (`npx supabase start`, needs Docker) **or** the migration
  pushed to the linked project (`npx supabase db push`).
- A real `OPENROUTER_API_KEY` set in `.dev.vars` (the committed value is a `###`
  placeholder).
- `npm run dev` running.

## Automated

- [ ] `npx supabase db reset` applies `20260607150000_first_grounded_session.sql`
      cleanly; the `materials` bucket exists and is private.
- [ ] `npx supabase test db` passes — `plan(29)`, including the new Storage-object
      and `extracted_text` isolation assertions.
- [ ] `npx supabase gen types --local` produces no diff against the committed
      `src/db/database.types.ts` (confirms the hand-added `extracted_text` matches).
- [ ] `npm run build` is green.
- [ ] `npm run lint` is green **on a LF checkout / in CI** (the local Windows tree
      reports CRLF-only `prettier` errors; see the deferred CRLF task).

## Manual — happy path (PRD primary success criterion: one-sitting end-to-end)

1. [ ] Sign in; on the dashboard click **Start new session**.
2. [ ] Upload a real lecture **PDF**; confirm the progress indicator
       ("Reading your file…" → "Generating your session…").
3. [ ] The session renders at `/sessions/[id]` with **3–5 theory steps, each
       showing a source citation**, beside a 5-question MCQ panel and a milestone bar.
4. [ ] Repeat upload with a `.md` and a `.txt` file.
5. [ ] Answer each MCQ; confirm **immediate** correct/incorrect feedback per question.
6. [ ] After all five are answered, **Finish session** shows a percentage score.
7. [ ] **Reload** `/sessions/[id]`; the session, answers, feedback, and score are
       restored.

## Manual — errors (FR-004 / NFR)

8. [ ] Upload a file > 20 MB → explanatory error, no session created.
9. [ ] Upload an unsupported type (e.g. `.docx`) → explanatory error.
10. [ ] Upload a corrupted/password-protected PDF → explanatory error, no partial rows.

## Manual — isolation (NFR) & grounding (wedge)

11. [ ] As a **second account**, open the first account's `/sessions/[id]` URL →
        redirected away / not visible; the first account's uploaded file is not
        retrievable.
12. [ ] **Grounding spot-check:** every theory citation appears verbatim in the
        uploaded source (no off-source claims).
