// Live ask-the-tutor grounding eval (S-05, Phase 5) — the wedge guard.
//
// Runs the REAL streamed answer from answerQuestion against each fixture, then asserts by
// expectation kind:
//   - "grounded" (on-source): wrap the answer as a single-step session and judge it;
//     allGrounded is the oracle (never the model's own claim).
//   - "refusal" (off-source): the tutor must decline rather than answer from general
//     knowledge, so the off-source fact must never appear in the answer. (The judge is not
//     used here — it grades factual prose against a source and would wrongly flag a refusal.)
//
// Opt-in + keyed + non-deterministic: `*.livejudge.test.ts` is EXCLUDED from `npm test`.
// Run with `npm run test:livejudge` (requires a real OPENROUTER_API_KEY; the config loads
// it from .dev.vars / .env and fails fast when absent).

import { describe, expect, it } from "vitest";

import type { GeneratedSession } from "@/lib/services/generation/schema";
import { judgeGrounding } from "@/lib/services/grounding/judge";
import { answerQuestion } from "@/lib/services/qa/answer";
import { QA_GROUNDING_FIXTURES } from "@/test/grounding/qa-fixtures";

/** Drain the streamed answer into a single string. */
async function collect(stream: AsyncGenerator<string>): Promise<string> {
  let answer = "";
  for await (const delta of stream) answer += delta;
  return answer;
}

/** Wrap a free-prose answer as a minimal session so the grounding judge can grade it:
 *  the answer becomes the single theory.body claim; the generic heading asserts no fact. */
function answerAsSession(answer: string): GeneratedSession {
  return {
    title: "",
    theory: [{ position: 0, heading: "Tutor answer", body: answer, citation: "" }],
    exercises: [],
  };
}

describe("ask-the-tutor — live grounding of streamed answers", () => {
  for (const fixture of QA_GROUNDING_FIXTURES) {
    it(
      fixture.name,
      async () => {
        const answer = await collect(answerQuestion(fixture.source, [], fixture.question));
        expect(answer.trim().length).toBeGreaterThan(0);

        if (fixture.expect.kind === "grounded") {
          const result = await judgeGrounding(answerAsSession(answer), fixture.source);
          expect(
            result.allGrounded,
            `answer went off-source; judge flagged: ${JSON.stringify(result.ungrounded)}\nanswer: ${answer}`,
          ).toBe(true);
        } else {
          // The wedge holds iff the off-source fact never appears (a refusal never states it).
          const lowered = answer.toLowerCase();
          for (const token of fixture.expect.mustNotContain) {
            expect(lowered, `expected a refusal, but the answer leaked "${token}": ${answer}`).not.toContain(
              token.toLowerCase(),
            );
          }
        }
      },
      30_000,
    );
  }
});
