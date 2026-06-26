// Fixtures for the live ask-the-tutor grounding eval (S-05, Phase 5).
//
// Each fixture is a (source, question) a learner could ask mid-session. The eval runs the
// real streamed answer through the grounding judge and asserts it stays grounded — the
// judge's allGrounded verdict is the oracle, never the model's own claim. The wedge guard
// is the off-source case: it must be REFUSED, not answered from general knowledge. A
// refusal makes no off-source factual claim, so it stays grounded; a fabricated answer is
// flagged and the eval fails.
//
// Reuses the Roman-aqueducts passage from the session-grounding fixtures so both evals
// reason over the same enumerable facts.

import { GROUNDING_SOURCE } from "./fixtures";

export interface QaGroundingFixture {
  name: string;
  source: string;
  question: string;
}

export const QA_GROUNDING_FIXTURES: QaGroundingFixture[] = [
  {
    name: "on-source mechanism question → grounded answer",
    source: GROUNDING_SOURCE,
    question: "How did Roman aqueducts keep the water moving across long distances?",
  },
  {
    name: "on-source detail question → grounded answer",
    source: GROUNDING_SOURCE,
    question: "Who was responsible for maintaining the aqueducts?",
  },
  {
    name: "off-source question → refusal stays grounded (no fabricated claim)",
    source: GROUNDING_SOURCE,
    question: "What is the boiling point of water in degrees Fahrenheit?",
  },
];
