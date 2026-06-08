import { describe, expect, it } from "vitest";

import { KNOWLEDGE_LEVELS, TIME_BUDGETS, type SessionIntake } from "@/types";
import { sizeFromIntake } from "./sizing";

function intake(overrides: Partial<SessionIntake> = {}): SessionIntake {
  return {
    knowledgeLevel: "intermediate",
    learningGoal: "learn the basics",
    timeBudgetMinutes: 30,
    ...overrides,
  };
}

describe("sizeFromIntake", () => {
  it("is monotonic in time budget — more time never yields fewer steps/MCQs", () => {
    const s15 = sizeFromIntake(intake({ timeBudgetMinutes: 15 }));
    const s30 = sizeFromIntake(intake({ timeBudgetMinutes: 30 }));
    const s60 = sizeFromIntake(intake({ timeBudgetMinutes: 60 }));

    expect(s30.theoryMin).toBeGreaterThanOrEqual(s15.theoryMin);
    expect(s30.theoryMax).toBeGreaterThanOrEqual(s15.theoryMax);
    expect(s30.mcqCount).toBeGreaterThanOrEqual(s15.mcqCount);

    expect(s60.theoryMin).toBeGreaterThanOrEqual(s30.theoryMin);
    expect(s60.theoryMax).toBeGreaterThanOrEqual(s30.theoryMax);
    expect(s60.mcqCount).toBeGreaterThanOrEqual(s30.mcqCount);
  });

  it("produces at least two distinct count-shapes across the three time buckets", () => {
    const shapes = TIME_BUDGETS.map((timeBudgetMinutes) => {
      const { theoryMin, theoryMax, mcqCount } = sizeFromIntake(intake({ timeBudgetMinutes }));
      return `${theoryMin}-${theoryMax}-${mcqCount}`;
    });
    expect(new Set(shapes).size).toBeGreaterThanOrEqual(2);
  });

  it("keeps theory bounds well-formed (min <= max, positive counts)", () => {
    for (const timeBudgetMinutes of TIME_BUDGETS) {
      const sizing = sizeFromIntake(intake({ timeBudgetMinutes }));
      expect(sizing.theoryMin).toBeGreaterThan(0);
      expect(sizing.theoryMin).toBeLessThanOrEqual(sizing.theoryMax);
      expect(sizing.mcqCount).toBeGreaterThan(0);
    }
  });

  it("varies depthGuidance by knowledge level", () => {
    const guidances = KNOWLEDGE_LEVELS.map(
      (knowledgeLevel) => sizeFromIntake(intake({ knowledgeLevel })).depthGuidance,
    );
    // Every level yields a non-empty directive, and they are all distinct.
    expect(guidances.every((g) => g.trim().length > 0)).toBe(true);
    expect(new Set(guidances).size).toBe(KNOWLEDGE_LEVELS.length);
  });
});
