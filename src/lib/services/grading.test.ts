// Per-type grading unit tests (S-04). Covers the correctness rules for each
// exercise kind in the pure gradeAnswer module — the score-correctness the
// roadmap centers on — independent of HTTP/DB.

import { describe, expect, it } from "vitest";

import { gradeAnswer } from "./grading";

describe("gradeAnswer — mcq", () => {
  const correct_answer = "Chemical energy";

  it("is correct on an exact option match", () => {
    expect(gradeAnswer({ kind: "mcq", correct_answer, submitted: "Chemical energy" })).toBe(true);
  });

  it("is incorrect on a different option", () => {
    expect(gradeAnswer({ kind: "mcq", correct_answer, submitted: "Kinetic energy" })).toBe(false);
  });

  it("does not normalize — a case/space variant of an option is incorrect", () => {
    expect(gradeAnswer({ kind: "mcq", correct_answer, submitted: "chemical energy" })).toBe(false);
  });

  it("is incorrect when the submission is not a string", () => {
    expect(gradeAnswer({ kind: "mcq", correct_answer, submitted: { a: "b" } })).toBe(false);
  });
});

describe("gradeAnswer — fill_blank", () => {
  const correct_answer = { answer: "Mitochondria", acceptable: ["the mitochondrion"] };

  it("is correct on an exact answer", () => {
    expect(gradeAnswer({ kind: "fill_blank", correct_answer, submitted: "Mitochondria" })).toBe(true);
  });

  it("is correct ignoring case", () => {
    expect(gradeAnswer({ kind: "fill_blank", correct_answer, submitted: "mitochondria" })).toBe(true);
  });

  it("is correct ignoring surrounding and internal whitespace", () => {
    expect(gradeAnswer({ kind: "fill_blank", correct_answer, submitted: "  Mito chondria " })).toBe(false);
    expect(gradeAnswer({ kind: "fill_blank", correct_answer, submitted: "  Mitochondria  " })).toBe(true);
  });

  it("accepts a listed acceptable variant (normalized)", () => {
    expect(gradeAnswer({ kind: "fill_blank", correct_answer, submitted: "The Mitochondrion" })).toBe(true);
  });

  it("is incorrect on a wrong answer", () => {
    expect(gradeAnswer({ kind: "fill_blank", correct_answer, submitted: "Ribosome" })).toBe(false);
  });

  it("tolerates a missing acceptable list", () => {
    expect(gradeAnswer({ kind: "fill_blank", correct_answer: { answer: "x" }, submitted: "x" })).toBe(true);
  });

  it("is incorrect when correct_answer is malformed", () => {
    expect(gradeAnswer({ kind: "fill_blank", correct_answer: null, submitted: "x" })).toBe(false);
    expect(gradeAnswer({ kind: "fill_blank", correct_answer: { answer: 5 }, submitted: "5" })).toBe(false);
  });
});

describe("gradeAnswer — matching (all-or-nothing)", () => {
  const correct_answer = {
    pairs: [
      { left: "Dog", right: "Mammal" },
      { left: "Frog", right: "Amphibian" },
      { left: "Eagle", right: "Bird" },
      { left: "Shark", right: "Fish" },
    ],
  };

  it("is correct when every pair is matched, regardless of key order", () => {
    expect(
      gradeAnswer({
        kind: "matching",
        correct_answer,
        submitted: { Shark: "Fish", Dog: "Mammal", Eagle: "Bird", Frog: "Amphibian" },
      }),
    ).toBe(true);
  });

  it("is incorrect when a single pair is wrong", () => {
    expect(
      gradeAnswer({
        kind: "matching",
        correct_answer,
        submitted: { Dog: "Mammal", Frog: "Bird", Eagle: "Amphibian", Shark: "Fish" },
      }),
    ).toBe(false);
  });

  it("is incorrect when a pair is missing from the submission", () => {
    expect(
      gradeAnswer({
        kind: "matching",
        correct_answer,
        submitted: { Dog: "Mammal", Frog: "Amphibian", Eagle: "Bird" },
      }),
    ).toBe(false);
  });

  it("is incorrect when the submission carries extra/unknown keys (strict shape)", () => {
    expect(
      gradeAnswer({
        kind: "matching",
        correct_answer,
        submitted: { Dog: "Mammal", Frog: "Amphibian", Eagle: "Bird", Shark: "Fish", Bonus: "Reptile" },
      }),
    ).toBe(false);
  });

  it("is incorrect when the submission is not a string→string mapping", () => {
    expect(gradeAnswer({ kind: "matching", correct_answer, submitted: "Mammal" })).toBe(false);
    expect(gradeAnswer({ kind: "matching", correct_answer, submitted: ["Mammal"] })).toBe(false);
    expect(gradeAnswer({ kind: "matching", correct_answer, submitted: { Dog: 1 } })).toBe(false);
  });

  it("is incorrect when correct_answer has no pairs", () => {
    expect(gradeAnswer({ kind: "matching", correct_answer: { pairs: [] }, submitted: {} })).toBe(false);
    expect(gradeAnswer({ kind: "matching", correct_answer: null, submitted: {} })).toBe(false);
  });
});

describe("gradeAnswer — unknown kind", () => {
  it("grades an unrecognized kind as incorrect", () => {
    expect(gradeAnswer({ kind: "essay", correct_answer: "x", submitted: "x" })).toBe(false);
  });
});
