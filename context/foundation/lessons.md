# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Lazy-import browser-only libraries in SSR'd islands

- **Context**: Any React island rendered with `client:load`/`client:visible` (Astro on Cloudflare Workers) that imports a browser-only library (pdf.js, anything touching DOM globals like DOMMatrix, canvas, window).
- **Problem**: Astro server-renders client:load islands once, evaluating the island's full module graph on the Worker — where browser globals don't exist. A top-level `import * as pdfjsLib from "pdfjs-dist"` in parseFile.ts 500'd /sessions/new in prod with "ReferenceError: DOMMatrix is not defined". infrastructure.md had pre-flagged this exact class of trap.
- **Rule**: Never import a browser-only library at the top level of a module that can enter the SSR bundle. Load it via dynamic `import()` inside the browser-only code path so it never evaluates during server render. Type-only imports are safe (erased at compile).
- **Applies to**: plan, implement, impl-review
