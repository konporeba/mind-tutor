import { describe, expect, it } from "vitest";

import type { SessionIntake } from "@/types";
import { buildMessages } from "./generate";
import { sizeFromIntake } from "./sizing";

const SOURCE = "Photosynthesis converts light energy into chemical energy stored in glucose.";

function render(intake: SessionIntake, bio?: string | null): string {
  const messages = buildMessages(SOURCE, intake, sizeFromIntake(intake), bio);
  return messages.map((m) => m.content).join("\n");
}

const BIO_INTAKE: SessionIntake = {
  knowledgeLevel: "intermediate",
  learningGoal: "understand the basics",
  timeBudgetMinutes: 30,
};

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

describe("buildMessages with bio (S-03)", () => {
  it("injects a non-empty bio as a learner-background framing line", () => {
    const prompt = render(BIO_INTAKE, "Senior backend engineer with 10 years in distributed systems.");
    expect(prompt).toContain("Learner background");
    expect(prompt).toContain("Senior backend engineer with 10 years in distributed systems");
  });

  it("omits the bio block entirely for a null or empty bio (byte-identical to no-bio)", () => {
    const noBio = render(BIO_INTAKE);
    expect(render(BIO_INTAKE, null)).toEqual(noBio);
    expect(render(BIO_INTAKE, "")).toEqual(noBio);
    expect(render(BIO_INTAKE, "   ")).toEqual(noBio);
    expect(noBio).not.toContain("Learner background");
  });

  it("produces different prompts for different bios on the same source + intake", () => {
    const student = render(BIO_INTAKE, "First-year student new to programming.");
    const engineer = render(BIO_INTAKE, "Senior engineer fluent in functional programming.");
    expect(student).not.toEqual(engineer);
  });
});
