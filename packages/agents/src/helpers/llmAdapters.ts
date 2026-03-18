import type { LanguageModel } from "ai";
import type { DecomposedClaim } from "../types.js";
import type { GraphResult, RecursiveSlot } from "./claimPlanner.js";
import { safeTrim, normalizeForCompare } from "./text.js";

import { retryWithBackoff, isLlmUnavailable } from "../utils/concurrency.js";
import { WEAK_OBJECT_PLACEHOLDERS, PREP_ONLY_RE } from "./rules/extractionRules.js";
import { trackFallback } from "./fallbackTracker.js";
import { fixCompoundPredicate } from "./canonicalization.js";

export type DecomposeDeps = {
  runClaimDecomposer: (model: LanguageModel, payload: string) => Promise<{ keep: boolean; reason?: string; claims: Array<{ text: string; role: string; group?: number; candidateKind?: string | null; confidence?: number | null }> }>;
  getGroqModel: () => LanguageModel;
};

export async function selectAndDecompose(
  header_context: string,
  previous_sentence: string,
  sentence: string,
  deps: DecomposeDeps,
): Promise<{ keep: false; reason: string } | { keep: true; claims: DecomposedClaim[] }> {
  const payload = JSON.stringify({ header_context, previous_sentence, sentence });

  try {
    const result = await retryWithBackoff(() => deps.runClaimDecomposer(deps.getGroqModel(), payload));
    if (!result.keep) return { keep: false, reason: result.reason || "Not a debatable claim." };
    const VALID_KINDS = new Set(["causal", "conditional", "meta", "standard"]);
    const rawClaims: DecomposedClaim[] = result.claims
      .filter((c) => safeTrim(c.text))
      .map((c) => ({
        text: safeTrim(c.text) as string,
        role: c.role as DecomposedClaim["role"],
        group: c.group ?? 0,
        candidateKind: (c.candidateKind && VALID_KINDS.has(c.candidateKind) ? c.candidateKind : null) as DecomposedClaim["candidateKind"],
        confidence: typeof c.confidence === "number" ? c.confidence : null,
      }));

    const claims = rawClaims.length > 0 ? rawClaims : [{ text: sentence.trim(), role: "MAIN" as const, group: 0 }];
    return { keep: true, claims };
  } catch (err) {
    console.error("[selectAndDecompose] LLM error:", err);
    if (isLlmUnavailable(err)) throw err;
    return { keep: true, claims: [{ text: sentence.trim(), role: "MAIN" as const, group: 0 }] };
  }
}

export type GraphDeps = {
  runGraphExtraction: (model: LanguageModel, payload: string) => Promise<{ core: { subject: RecursiveSlot; predicate: string; object: RecursiveSlot }; modifiers: Array<{ prep: string; value: string }> }>;
  getGroqModel: () => LanguageModel;
};

export function flattenSlot(slot: RecursiveSlot): string {
  if (typeof slot === "string") return slot;
  return `${flattenSlot(slot.subject)} ${slot.predicate} ${flattenSlot(slot.object)}`;
}

const MODAL_MAIN_RE = /^(.+?)\s+(should|must|can|could|would|will|may|might|need to|ought to)\s+(.+)$/i;

function normalizeCoreWithClaimText(
  core: { subject: string; predicate: string; object: string },
  claimText: string,
): { subject: string; predicate: string; object: string } {
  const text = claimText.trim().replace(/\.\s*$/, "");
  const m = text.match(MODAL_MAIN_RE);
  if (!m) return core;

  const sentenceSubject = m[1].trim();
  const modal = m[2].trim().toLowerCase();
  const sentenceRemainder = m[3].trim();
  if (!sentenceSubject || !sentenceRemainder) return core;

  const subjectNorm = normalizeForCompare(core.subject);
  const objectNorm = normalizeForCompare(core.object);
  const sentenceSubjectNorm = normalizeForCompare(sentenceSubject);

  const objectLooksWeak =
    objectNorm === subjectNorm ||
    objectNorm === sentenceSubjectNorm ||
    WEAK_OBJECT_PLACEHOLDERS.has(objectNorm);
  if (!objectLooksWeak) return core;

  if (WEAK_OBJECT_PLACEHOLDERS.has(objectNorm)) {
    const escaped = objectNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) return core;
  }

  const subjectMatchesSentence =
    subjectNorm === sentenceSubjectNorm ||
    subjectNorm.includes(sentenceSubjectNorm) ||
    sentenceSubjectNorm.includes(subjectNorm);
  if (!subjectMatchesSentence) return core;

  trackFallback("normalizeCoreWithClaimText");
  return { subject: sentenceSubject, predicate: modal, object: sentenceRemainder };
}

function isRedundantModifier(
  mod: { prep: string; value: string },
  core: { subject: string; predicate: string; object: string },
): boolean {
  const valueNorm = normalizeForCompare(mod.value);
  if (!valueNorm) return true;

  const subjectNorm = normalizeForCompare(core.subject);
  const objectNorm = normalizeForCompare(core.object);

  return valueNorm === subjectNorm || valueNorm === objectNorm;
}

const NEST_PREPS = new Set(["in", "on", "for", "from", "with", "about", "by", "through", "over", "against"]);

const FIXED_FLAT_RE = /\b(freedom of speech|quality of life|cost of living|burden of proof|standard of living|balance of power|united states of america|state of the art)\b/i;
const QUANTIFIED_OF_RE = /\b(millions?|thousands?|hundreds?|billions?|dozens?|most|some|many|all|none|few|plenty|lack)\s+of\b/i;

/**
 * Try to nest a flat string into a RecursiveSlot by splitting at preposition boundaries.
 * Scans right-to-left so the outermost prep becomes the top-level split.
 * Only activates for strings > 4 words.
 */
export function tryNestFlatSlot(text: string): RecursiveSlot {
  const words = text.split(/\s+/);
  if (words.length <= 4) return text;
  if (FIXED_FLAT_RE.test(text)) return text;
  if (QUANTIFIED_OF_RE.test(text)) return text;

  for (let i = words.length - 2; i >= 2; i--) {
    const w = words[i].toLowerCase();

    // "to + verb" infinitive pattern
    if (w === "to" && i + 1 < words.length) {
      const left = words.slice(0, i).join(" ");
      const right = words.slice(i + 2).join(" ");
      if (left && right) {
        const predicate = `${words[i]} ${words[i + 1]}`;
        return { subject: tryNestFlatSlot(left), predicate, object: right };
      }
    }

    if (NEST_PREPS.has(w)) {
      if (w === "of" && i >= 1 && QUANTIFIED_OF_RE.test(words.slice(Math.max(0, i - 1), i + 2).join(" "))) continue;

      const left = words.slice(0, i).join(" ");
      const right = words.slice(i + 1).join(" ");
      if (left && right) {
        return { subject: tryNestFlatSlot(left), predicate: words[i], object: right };
      }
    }
  }

  return text;
}

// Time preps almost always modify the predicate, not a slot — skip absorption for these.
const TIME_PREPS = new Set(["within", "since", "during", "before", "after", "until", "by"]);

/**
 * Absorb modifiers whose "prep value" trails a slot's flat text in the original claim.
 * Works on FLAT text, before nesting, so even a 2-word object like "the ability"
 * gets extended to "the ability to think critically on their own" before tryNestFlatSlot.
 */
function absorbAdjacentModifiers(
  slotText: string,
  modifiers: Array<{ prep: string; value: string }>,
  claimText: string,
): { extendedText: string; remaining: Array<{ prep: string; value: string }> } {
  if (!modifiers.length) return { extendedText: slotText, remaining: modifiers };

  const cleanClaim = claimText.toLowerCase().replace(/\.\s*$/, "");
  let currentLower = slotText.toLowerCase();
  const remaining: Array<{ prep: string; value: string }> = [];

  for (const mod of modifiers) {
    const firstWord = mod.prep.split(/\s+/)[0].toLowerCase();
    if (TIME_PREPS.has(firstWord)) { remaining.push(mod); continue; }

    const extended = `${currentLower} ${mod.prep} ${mod.value}`.toLowerCase();
    if (cleanClaim.includes(extended)) {
      currentLower = extended;
    } else {
      remaining.push(mod);
    }
  }

  if (currentLower === slotText.toLowerCase()) return { extendedText: slotText, remaining: modifiers };

  // Recover original casing from claim text
  const idx = cleanClaim.indexOf(currentLower);
  if (idx >= 0) {
    const originalCase = claimText.trim().replace(/\.\s*$/, "").slice(idx, idx + currentLower.length);
    return { extendedText: originalCase, remaining };
  }

  return { extendedText: slotText, remaining: modifiers };
}

export async function graphFromClaim(claimText: string, sentenceContext: string, deps: GraphDeps): Promise<GraphResult | null> {
  const payload = JSON.stringify({ claim: claimText, sentence_context: sentenceContext });

  try {
    const parsed = await retryWithBackoff(() => deps.runGraphExtraction(deps.getGroqModel(), payload));

    const c = parsed.core;
    const flatSubject = flattenSlot(c.subject).trim();
    const flatObject = flattenSlot(c.object).trim();
    if (!flatSubject || !c.predicate?.trim() || !flatObject) return null;
    if (PREP_ONLY_RE.test(c.predicate.trim().toLowerCase())) return null;

    const rawCore = { subject: flatSubject, predicate: c.predicate.trim(), object: flatObject };
    const fixedCore = fixCompoundPredicate(rawCore);
    const normalizedCore = normalizeCoreWithClaimText(fixedCore, claimText);
    const rawModifiers = parsed.modifiers
      .map((m) => ({ prep: m.prep.trim(), value: m.value.trim() }))
      .filter((m) => m.prep && m.value);

    const allModifiers = rawModifiers.filter((m) => !isRedundantModifier(m, normalizedCore));

    const { extendedText: fullObject, remaining: afterObjAbsorb } = typeof c.object === "string"
      ? absorbAdjacentModifiers(normalizedCore.object, allModifiers, claimText)
      : { extendedText: normalizedCore.object, remaining: allModifiers };
    const { extendedText: fullSubject, remaining: afterSubjAbsorb } = typeof c.subject === "string"
      ? absorbAdjacentModifiers(normalizedCore.subject, afterObjAbsorb, claimText)
      : { extendedText: normalizedCore.subject, remaining: afterObjAbsorb };

    const recursiveSubject = typeof c.subject !== "string"
      ? c.subject
      : tryNestFlatSlot(fullSubject);
    const recursiveObject = typeof c.object !== "string"
      ? c.object
      : tryNestFlatSlot(fullObject);

    const result = {
      core: normalizedCore,
      modifiers: afterSubjAbsorb,
      recursiveSubject: typeof recursiveSubject !== "string" ? recursiveSubject : undefined,
      recursiveObject: typeof recursiveObject !== "string" ? recursiveObject : undefined,
    };
    return result;
  } catch (err) {
    console.error("[graphFromClaim] LLM error:", err);
    if (isLlmUnavailable(err)) throw err;
    return null;
  }
}
