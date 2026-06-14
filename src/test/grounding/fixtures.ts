// Adversarial fixtures for the live grounding judge (test-plan Phase 4).
//
// Each fixture pairs a source with a hand-authored GeneratedSession whose PASS/FLAG
// outcome WE label — the label is the oracle, never the judge's own output (the §2
// oracle anti-pattern). The prose is real (unlike Phase 1's placeholder
// buildValidSession), so there is a genuine claim to confirm or a genuine
// hallucination to plant. Cases:
//   - faithful      : every claim supported, reworded (tests semantics, not substring) -> PASS
//   - planted       : a theory.body sentence contradicts the source                    -> FLAG
//   - truncation    : a claim supported ONLY beyond the 60k cap the judge sees         -> FLAG
//   - distractor    : correct option + prose grounded; distractors blatantly false     -> PASS
//                     (proves distractors never reach the judge — the exemption holds)

import { buildLargeSource } from "@/test/generation/completion-builder";
import type { GeneratedSession } from "@/lib/services/generation/schema";
import type { GroundingField } from "@/lib/services/grounding/schema";

/** A self-contained passage with enumerable facts (gravity gradient, eleven aqueducts,
 *  mostly underground, arched bridges over valleys, lead pipes, curator aquarum). */
export const GROUNDING_SOURCE = [
  "Roman aqueducts carried water across long distances using a slight downward gradient.",
  "By the third century AD the city of Rome was served by eleven aqueducts.",
  "Most aqueduct channels ran underground to protect the water from contamination and theft.",
  "Where valleys had to be crossed, engineers built arched bridges to keep the gradient steady.",
  "The water was distributed through lead pipes to public fountains, baths, and a few private homes.",
  "Maintenance of the aqueducts was overseen by an official called the curator aquarum.",
].join(" ");

export interface GroundingFixture {
  name: string;
  source: string;
  session: GeneratedSession;
  /** null → expect every claim grounded (PASS). Otherwise the field that MUST appear
   *  in the judge's ungrounded set (FLAG). */
  expectFlaggedField: GroundingField | null;
}

/** All prose faithfully paraphrases the source (reworded so the judge must reason about
 *  meaning, not substring). Distractors are off-source but never submitted. → PASS */
const faithful: GeneratedSession = {
  title: "Roman Aqueducts",
  theory: [
    {
      position: 0,
      heading: "How aqueducts moved water",
      body: "Roman aqueducts moved water over great distances by relying on a gentle downhill slope, and most of their channels were buried underground to keep the water clean.",
      citation: "carried water across long distances using a slight downward gradient",
    },
  ],
  exercises: [
    {
      position: 0,
      prompt: "Why did engineers build arched bridges along some aqueducts?",
      options: [
        "To keep the steady downhill gradient where the channel had to cross a valley",
        "To display the wealth of the Roman Senate",
        "To provide shelter for marching legions",
      ],
      correctIndex: 0,
      feedback: "Arched bridges let the channel keep its steady gradient where it had to cross a valley.",
    },
  ],
};

/** theory.body asserts a mechanism the source contradicts (gravity gradient, not pumps). → FLAG */
const planted: GeneratedSession = {
  title: "Roman Aqueducts",
  theory: [
    {
      position: 0,
      heading: "How aqueducts moved water",
      body: "Roman aqueducts were powered by large steam pumps that pushed the water uphill into the city against gravity.",
      citation: "carried water across long distances using a slight downward gradient",
    },
  ],
  exercises: [
    {
      position: 0,
      prompt: "How was the water in a Roman aqueduct kept moving?",
      options: ["By a slight downward gradient", "By steam-powered pumps", "By teams of rowers"],
      correctIndex: 0,
      feedback: "The water flowed because of the aqueduct's slight downward gradient.",
    },
  ],
};

/** The claim is supported only by a span placed beyond the 60k cap the judge truncates
 *  to, so against the visible slice it is ungrounded. Mirrors the Phase 1 truncation edge. → FLAG */
const truncationCitedSpan = "The curator aquarum personally inspected every public fountain in Rome once each day.";
const truncation: GeneratedSession = {
  title: "Aqueduct Maintenance",
  theory: [
    {
      position: 0,
      heading: "Daily inspection",
      body: "The curator aquarum personally inspected every public fountain in Rome once each day.",
      citation: truncationCitedSpan,
    },
  ],
  exercises: [
    {
      position: 0,
      prompt: "How often did the curator aquarum inspect each fountain?",
      options: ["Once a day", "Once a month", "Once a year"],
      correctIndex: 0,
      feedback: "The curator aquarum inspected each fountain once a day.",
    },
  ],
};

/** Correct option + prose grounded; distractors are blatantly false. If the exemption
 *  failed and distractors reached the judge, it would flag them — so PASS proves the
 *  exemption holds end-to-end against a real model. → PASS */
const distractorControl: GeneratedSession = {
  title: "Roman Aqueducts",
  theory: [
    {
      position: 0,
      heading: "Distribution",
      body: "Aqueduct water reached public fountains, baths, and a small number of private homes through lead pipes.",
      citation: "distributed through lead pipes to public fountains, baths, and a few private homes",
    },
  ],
  exercises: [
    {
      position: 0,
      prompt: "Through what were aqueduct waters distributed in the city?",
      options: ["Lead pipes", "The aqueducts were built by alien visitors", "Rome never had any aqueducts at all"],
      correctIndex: 0,
      feedback: "The water was carried through lead pipes to fountains, baths, and some private homes.",
    },
  ],
};

export const GROUNDING_FIXTURES: GroundingFixture[] = [
  { name: "faithful paraphrase → all grounded", source: GROUNDING_SOURCE, session: faithful, expectFlaggedField: null },
  {
    name: "planted contradiction in theory.body → flagged",
    source: GROUNDING_SOURCE,
    session: planted,
    expectFlaggedField: "theory.body",
  },
  {
    name: "supported only beyond the 60k cap → flagged",
    source: buildLargeSource(truncationCitedSpan),
    session: truncation,
    expectFlaggedField: "theory.body",
  },
  {
    name: "legitimate distractors never reach the judge → all grounded",
    source: GROUNDING_SOURCE,
    session: distractorControl,
    expectFlaggedField: null,
  },
];
