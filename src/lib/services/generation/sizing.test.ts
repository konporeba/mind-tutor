import { describe, expect, it } from "vitest";

import { EXERCISE_KINDS, KNOWLEDGE_LEVELS, TIME_BUDGETS, type SessionIntake } from "@/types";
import { sizeFromIntake } from "./sizing";

function intake(overrides: Partial<SessionIntake> = {}): SessionIntake {
  return {
    knowledgeLevel: "intermediate",
    learningGoal: "learn the basics",
    timeBudgetMinutes: 30,
    ...overrides,
  };
}

function total(intakeArg: SessionIntake): number {
  const { exerciseCounts } = sizeFromIntake(intakeArg);
  return exerciseCounts.mcq + exerciseCounts.fill_blank + exerciseCounts.matching;
}

describe("sizeFromIntake", () => {
  it("is monotonic in time budget — more time never yields fewer steps or exercises (per type or total)", () => {
    const s15 = sizeFromIntake(intake({ timeBudgetMinutes: 15 }));
    const s30 = sizeFromIntake(intake({ timeBudgetMinutes: 30 }));
    const s60 = sizeFromIntake(intake({ timeBudgetMinutes: 60 }));

    for (const [lower, higher] of [
      [s15, s30],
      [s30, s60],
    ] as const) {
      expect(higher.theoryMin).toBeGreaterThanOrEqual(lower.theoryMin);
      expect(higher.theoryMax).toBeGreaterThanOrEqual(lower.theoryMax);
      for (const kind of EXERCISE_KINDS) {
        expect(higher.exerciseCounts[kind]).toBeGreaterThanOrEqual(lower.exerciseCounts[kind]);
      }
    }

    expect(total(intake({ timeBudgetMinutes: 30 }))).toBeGreaterThanOrEqual(total(intake({ timeBudgetMinutes: 15 })));
    expect(total(intake({ timeBudgetMinutes: 60 }))).toBeGreaterThanOrEqual(total(intake({ timeBudgetMinutes: 30 })));
  });

  it("includes all three exercise types at every time budget (the FR-009 multi-type guarantee)", () => {
    for (const timeBudgetMinutes of TIME_BUDGETS) {
      const { exerciseCounts } = sizeFromIntake(intake({ timeBudgetMinutes }));
      for (const kind of EXERCISE_KINDS) {
        expect(exerciseCounts[kind]).toBeGreaterThan(0);
      }
    }
  });

  it("produces at least two distinct count-shapes across the three time buckets", () => {
    const shapes = TIME_BUDGETS.map((timeBudgetMinutes) => {
      const { theoryMin, theoryMax, exerciseCounts } = sizeFromIntake(intake({ timeBudgetMinutes }));
      return `${theoryMin}-${theoryMax}-${exerciseCounts.mcq}-${exerciseCounts.fill_blank}-${exerciseCounts.matching}`;
    });
    expect(new Set(shapes).size).toBeGreaterThanOrEqual(2);
  });

  it("keeps theory bounds well-formed (min <= max, positive total exercises)", () => {
    for (const timeBudgetMinutes of TIME_BUDGETS) {
      const sizing = sizeFromIntake(intake({ timeBudgetMinutes }));
      expect(sizing.theoryMin).toBeGreaterThan(0);
      expect(sizing.theoryMin).toBeLessThanOrEqual(sizing.theoryMax);
      expect(total(intake({ timeBudgetMinutes }))).toBeGreaterThan(0);
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
