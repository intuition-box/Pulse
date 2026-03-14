import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";
import { requireEnv } from "./env.js";
import { getGroqModelName, getGroqModelNameLight } from "./env.js";

let cached: ReturnType<typeof createGroq> | null = null;

export function getGroq() {
  if (cached) return cached;

  const apiKey = requireEnv("GROQ_API_KEY");

  cached = createGroq({
    apiKey,
  });

  return cached;
}

let cachedModel: LanguageModel | null = null;


/** Returns a ready-to-use LanguageModel for Groq (heavy). */
export function getGroqModel(): LanguageModel {
  if (cachedModel) return cachedModel;
  cachedModel = getGroq()(getGroqModelName());
  return cachedModel;
}

let cachedModelLight: LanguageModel | null = null;

/** Light model for simple tasks (atom matching, relation linking). */
export function getGroqModelLight(): LanguageModel {
  if (cachedModelLight) return cachedModelLight;
  cachedModelLight = getGroq()(getGroqModelNameLight());
  return cachedModelLight;
}
