// Generation contract (S-01).
//
// The structured shape the LLM must return for a grounded session, plus the
// shapes we persist. OpenRouter does not strictly enforce a JSON schema across
// all models, so every response is parsed and zod-validated rather than trusted
// (see generate.ts). Keep these schemas as the single source of truth shared by
// the generation service (Phase 2) and the API layer that persists rows (Phase 3).

import { z } from "zod";

import type { SessionSizing } from "./sizing";

// Bounds for a single-sitting session (fixed default; intake-driven sizing is S-02).
export const THEORY_MIN = 3;
export const THEORY_MAX = 5;
export const MCQ_COUNT = 5;
export const MCQ_MIN_OPTIONS = 3;
export const MCQ_MAX_OPTIONS = 5;

// One guided theory step. `citation` is a verbatim span lifted from the source;
// generate.ts validates it actually occurs in the source text (the grounding wedge).
export const TheoryStepSchema = z.object({
  position: z.number().int().nonnegative(),
  heading: z.string().min(1),
  body: z.string().min(1),
  citation: z.string().min(1),
});

// One multiple-choice exercise. `correctIndex` points into `options`.
export const McqSchema = z
  .object({
    position: z.number().int().nonnegative(),
    prompt: z.string().min(1),
    options: z.array(z.string().min(1)).min(MCQ_MIN_OPTIONS).max(MCQ_MAX_OPTIONS),
    correctIndex: z.number().int().nonnegative(),
    feedback: z.string().min(1),
  })
  .refine((m) => m.correctIndex < m.options.length, {
    message: "correctIndex must be a valid index into options",
    path: ["correctIndex"],
  });

export const GeneratedSessionSchema = z.object({
  title: z.string().min(1),
  theory: z.array(TheoryStepSchema).min(THEORY_MIN).max(THEORY_MAX),
  exercises: z.array(McqSchema).length(MCQ_COUNT),
});

// Intake-driven variant (S-02): same per-item schemas (TheoryStep, Mcq), but the
// theory bounds and exact MCQ count come from the sizing map instead of the fixed
// module constants. generate.ts computes sizing once and uses this so the prompt
// and validation agree across retry attempts. GeneratedSessionSchema remains the
// fallback default for any call path without intake.
export function makeGeneratedSessionSchema(sizing: SessionSizing) {
  return z.object({
    title: z.string().min(1),
    theory: z.array(TheoryStepSchema).min(sizing.theoryMin).max(sizing.theoryMax),
    exercises: z.array(McqSchema).length(sizing.mcqCount),
  });
}

export type TheoryStep = z.infer<typeof TheoryStepSchema>;
export type Mcq = z.infer<typeof McqSchema>;
export type GeneratedSession = z.infer<typeof GeneratedSessionSchema>;

// Persisted shape of a theory step in generated_content.body (jsonb). The API
// layer (Phase 3) writes one generated_content row per theory step with kind
// 'theory', position, and this object as body.
export type TheoryBody = Pick<TheoryStep, "heading" | "body" | "citation">;
