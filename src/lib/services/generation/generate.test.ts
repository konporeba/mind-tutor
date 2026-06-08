import { describe, expect, it } from "vitest";

import type { SessionIntake } from "@/types";
import { buildMessages } from "./generate";
import { sizeFromIntake } from "./sizing";

const SOURCE = "Photosynthesis converts light energy into chemical energy stored in glucose.";

function render(intake: SessionIntake): string {
  const messages = buildMessages(SOURCE, intake, sizeFromIntake(intake));
  return messages.map((m) => m.content).join("\n");
}

describe("buildMessages", () => {
  it("injects the knowledge level, trimmed goal, time budget, and target counts into the prompt", () => {
    const intake: SessionIntake = {
      knowledgeLevel: "advanced",
      learningGoal: "  master the Calvin cycle  ",
      timeBudgetMinutes: 60,
    };
    const sizing = sizeFromIntake(intake);
    const prompt = render(intake);

    expect(prompt).toContain("advanced");
    // Goal appears trimmed, not with its surrounding whitespace.
    expect(prompt).toContain("master the Calvin cycle");
    expect(prompt).not.toContain("  master the Calvin cycle  ");
    expect(prompt).toContain("60");
    // Target counts from the sizing map are present in the shape spec.
    expect(prompt).toContain(`between ${sizing.theoryMin} and ${sizing.theoryMax}`);
    expect(prompt).toContain(`exactly ${sizing.mcqCount}`);
  });

  it("still carries the S-01 source-grounding rules", () => {
    const prompt = render({ knowledgeLevel: "novice", learningGoal: "get started", timeBudgetMinutes: 15 });
    expect(prompt).toContain("verbatim");
    expect(prompt).toContain(SOURCE);
  });

  it("produces different prompts for different intakes", () => {
    const a = render({ knowledgeLevel: "novice", learningGoal: "just the gist", timeBudgetMinutes: 15 });
    const b = render({ knowledgeLevel: "expert", learningGoal: "deep edge cases", timeBudgetMinutes: 60 });
    expect(a).not.toEqual(b);
  });
});
