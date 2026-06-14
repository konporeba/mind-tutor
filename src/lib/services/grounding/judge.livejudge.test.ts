// Grounding judge — live discrimination suite (test-plan Phase 4).
//
// Makes a REAL OpenRouter call (no seam mock) against hand-labeled adversarial
// fixtures and proves the judge actually DISCRIMINATES: it flags planted /
// contradictory / truncated-away claims, passes faithful paraphrases, and never
// false-flags a legitimate distractor (the exemption holds end-to-end). The label
// in each fixture is the oracle — never the model's own output.
//
// Opt-in + keyed + non-deterministic: the `*.livejudge.test.ts` suffix is EXCLUDED
// from the default `npm test`. Run with `npm run test:livejudge` (requires a real
// OPENROUTER_API_KEY; the config auto-loads it from .dev.vars / .env and fails fast
// when it is absent). This is the optional §5 CI gate.

import { describe, expect, it } from "vitest";

import { GROUNDING_FIXTURES } from "@/test/grounding/fixtures";
import { judgeGrounding } from "./judge";

describe("grounding judge — live discrimination against adversarial fixtures", () => {
  for (const fixture of GROUNDING_FIXTURES) {
    it(
      fixture.name,
      async () => {
        const result = await judgeGrounding(fixture.session, fixture.source);

        if (fixture.expectFlaggedField === null) {
          // PASS case: faithful prose / exempt distractors → nothing ungrounded.
          expect(
            result.allGrounded,
            `expected all grounded, but the judge flagged: ${JSON.stringify(result.ungrounded)}`,
          ).toBe(true);
        } else {
          // FLAG case: the planted / truncated-away claim must be caught.
          expect(
            result.allGrounded,
            `expected a flagged claim on ${fixture.expectFlaggedField}, but everything passed`,
          ).toBe(false);
          const flaggedFields = result.ungrounded.map((c) => c.field);
          expect(flaggedFields).toContain(fixture.expectFlaggedField);
        }
      },
      30_000,
    );
  }
});
