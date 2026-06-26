---
change_id: ask-tutor-mid-session
title: Ask tutor mid session
status: implemented
created: 2026-06-23
updated: 2026-06-26
archived_at: null
---

## Notes

### Phase 1 — Transport decision: **SSE confirmed** (2026-06-23)

Streaming probe (`api/spike/stream.ts`, since removed) proved incremental delivery end-to-end:

- **Dev** (`astro dev`, :4321): 5 synthetic chunks arrived ~600ms apart (embedded `Date.now()` ~600ms apart) — server flushed each chunk separately, not buffered.
- **Production build on workerd** (`astro preview`, :4323): same incremental ~600ms cadence — **`ReadableStream` / `text/event-stream` streams correctly on the Cloudflare Workers deploy runtime.** This was the load-bearing unknown.
- **OpenRouter `stream: true`**: real token deltas (`1`,` `,`2`,…`10`) streamed incrementally (~50ms apart) through `getOpenRouterClient()`, ending `[DONE]`.

**Decision:** Phases 3–4 use SSE (`text/event-stream` `ReadableStream` body, OpenAI SDK `stream: true`). No buffered fallback needed.
