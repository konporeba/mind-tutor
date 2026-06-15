// Generation contract (S-01, extended for multi-type exercises in S-04).
//
// The structured shape the LLM must return for a grounded session, plus the
// shapes we persist. OpenRouter does not strictly enforce a JSON schema across
// all models, so every response is parsed and zod-validated rather than trusted
// (see generate.ts). Keep these schemas as the single source of truth shared by
// the generation service and the API layer that persists rows.
//
// Exercises are a `kind`-discriminated union of three types (mcq / fill_blank /
// matching). The exact per-type counts come from the sizing map (S-02/S-04), so
// the prompt and validation agree across retry attempts.

import { z } from "zod";

import { EXERCISE_KINDS, type ExerciseKind } from "@/types";
import type { SessionSizing } from "./sizing";

export const MCQ_MIN_OPTIONS = 3;
export const MCQ_MAX_OPTIONS = 5;
export const MATCHING_MIN_PAIRS = 4;
export const MATCHING_MAX_PAIRS = 6;

// One guided theory step. `citation` is a verbatim span lifted from the source;
// generate.ts validates it actually occurs in the source text (the grounding wedge).
export const TheoryStepSchema = z.object({
  position: z.number().int().nonnegative(),
  heading: z.string().min(1),
  body: z.string().min(1),
  citation: z.string().min(1),
});

// One multiple-choice exercise. `correctIndex` points into `options`. The
// in-range invariant is checked at the array level (see makeGeneratedSessionSchema)
// rather than via `.refine()` here, because a discriminated-union member must be a
// plain object schema.
export const McqSchema = z.object({
  kind: z.literal("mcq"),
  position: z.number().int().nonnegative(),
  prompt: z.string().min(1),
  options: z.array(z.string().min(1)).min(MCQ_MIN_OPTIONS).max(MCQ_MAX_OPTIONS),
  correctIndex: z.number().int().nonnegative(),
  feedback: z.string().min(1),
});

// One fill-in-the-blank exercise. `prompt` contains a `___` marker where the
// answer goes; `answer` is the canonical answer and `acceptable` lists extra
// accepted variants (graded normalized + case-insensitive — see grading.ts).
export const FillBlankSchema = z.object({
  kind: z.literal("fill_blank"),
  position: z.number().int().nonnegative(),
  prompt: z.string().min(1),
  answer: z.string().min(1),
  acceptable: z.array(z.string().min(1)).default([]),
  feedback: z.string().min(1),
});

// One matching-pairs exercise. `pairs` is the CORRECT mapping (left ↔ right);
// persistence shuffles the right column once and stores it in `options`, keeping
// the truth in `correct_answer`. Graded all-or-nothing (see grading.ts).
export const MatchingPairSchema = z.object({
  left: z.string().min(1),
  right: z.string().min(1),
});

export const MatchingSchema = z.object({
  kind: z.literal("matching"),
  position: z.number().int().nonnegative(),
  prompt: z.string().min(1),
  pairs: z.array(MatchingPairSchema).min(MATCHING_MIN_PAIRS).max(MATCHING_MAX_PAIRS),
  feedback: z.string().min(1),
});

export const ExerciseItemSchema = z.discriminatedUnion("kind", [McqSchema, FillBlankSchema, MatchingSchema]);

// Intake-driven session schema (S-02/S-04): theory bounds and the exact per-type
// exercise counts come from the sizing map. The array-level superRefine enforces
// both the per-type counts and the MCQ correctIndex-in-range invariant, so a
// count mismatch or a bad index fails validation and triggers the generate.ts retry.
export function makeGeneratedSessionSchema(sizing: SessionSizing) {
  return z.object({
    title: z.string().min(1),
    theory: z.array(TheoryStepSchema).min(sizing.theoryMin).max(sizing.theoryMax),
    exercises: z.array(ExerciseItemSchema).superRefine((items, ctx) => {
      const counts: Record<ExerciseKind, number> = { mcq: 0, fill_blank: 0, matching: 0 };
      items.forEach((item, i) => {
        counts[item.kind] += 1;
        if (item.kind === "mcq" && item.correctIndex >= item.options.length) {
          ctx.addIssue({
            code: "custom",
            message: "correctIndex must be a valid index into options",
            path: [i, "correctIndex"],
          });
        }
      });
      for (const kind of EXERCISE_KINDS) {
        if (counts[kind] !== sizing.exerciseCounts[kind]) {
          ctx.addIssue({
            code: "custom",
            message: `expected ${sizing.exerciseCounts[kind]} ${kind} exercises but got ${counts[kind]}`,
            path: ["exercises"],
          });
        }
      }
    }),
  });
}

export type TheoryStep = z.infer<typeof TheoryStepSchema>;
export type Mcq = z.infer<typeof McqSchema>;
export type FillBlank = z.infer<typeof FillBlankSchema>;
export type Matching = z.infer<typeof MatchingSchema>;
export type MatchingPair = z.infer<typeof MatchingPairSchema>;
export type ExerciseItem = z.infer<typeof ExerciseItemSchema>;

export interface GeneratedSession {
  title: string;
  theory: TheoryStep[];
  exercises: ExerciseItem[];
}

// Persisted shape of a theory step in generated_content.body (jsonb). The API
// layer writes one generated_content row per theory step with kind 'theory',
// position, and this object as body.
export type TheoryBody = Pick<TheoryStep, "heading" | "body" | "citation">;
