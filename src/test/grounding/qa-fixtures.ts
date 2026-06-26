// Fixtures for the live ask-the-tutor grounding eval (S-05, Phase 5).
//
// Each fixture is a (source, question) a learner could ask mid-session, plus the expected
// behavior:
//   - "grounded": an on-source question. The real streamed answer is run through the
//     grounding judge; allGrounded must be true (the judge's verdict is the oracle).
//   - "refusal": an off-source question. The wedge requires a REFUSAL, not a
//     general-knowledge answer — so the answer must NOT contain the off-source fact
//     (`mustNotContain`). The grounding judge is deliberately NOT used here: it grades
//     factual prose against a source, and a refusal ("I can't find that in your material")
//     is meta-commentary the judge would wrongly flag as ungrounded.
//
// Reuses the Roman-aqueducts passage from the session-grounding fixtures so both evals
// reason over the same enumerable facts.

import { GROUNDING_SOURCE } from "./fixtures";

export type QaExpectation = { kind: "grounded" } | { kind: "refusal"; mustNotContain: string[] };

export interface QaGroundingFixture {
  name: string;
  source: string;
  question: string;
  expect: QaExpectation;
}

export const QA_GROUNDING_FIXTURES: QaGroundingFixture[] = [
  {
    name: "on-source mechanism question → grounded answer",
    source: GROUNDING_SOURCE,
    question: "How did Roman aqueducts keep the water moving across long distances?",
    expect: { kind: "grounded" },
  },
  {
    name: "on-source detail question → grounded answer",
    source: GROUNDING_SOURCE,
    question: "Who was responsible for maintaining the aqueducts?",
    expect: { kind: "grounded" },
  },
  {
    name: "off-source question → refused, no fabricated fact",
    source: GROUNDING_SOURCE,
    question: "What is the boiling point of water in degrees Fahrenheit?",
    // A fabricated answer would state 212; a proper refusal never does.
    expect: { kind: "refusal", mustNotContain: ["212"] },
  },
];
