// OpenRouter client (S-01).
//
// Provider-agnostic generation via OpenRouter's OpenAI-compatible API. The model
// is configured (OPENROUTER_MODEL) so it can be swapped without code changes.

import OpenAI from "openai";
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from "astro:env/server";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Thrown for any failure in the generation pipeline (config, API, validation). */
export class GenerationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GenerationError";
  }
}

/** Build the OpenRouter client, or throw if the key is unset (mirrors the
 *  supabase client's "missing env" posture, but generation cannot no-op). */
export function getOpenRouterClient(): OpenAI {
  if (!OPENROUTER_API_KEY) {
    throw new GenerationError("OPENROUTER_API_KEY is not configured");
  }
  return new OpenAI({
    apiKey: OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
  });
}

/** Configured model id (the env schema supplies the default). */
export function getModel(): string {
  return OPENROUTER_MODEL;
}
