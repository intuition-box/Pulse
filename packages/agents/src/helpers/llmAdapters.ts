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
  const payload = JSON.stringify({ header_context, previous_sentence, sentence }, null, 2);

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

export async function graphFromClaim(claimText: string, sentenceContext: string, deps: GraphDeps): Promise<GraphResult | null> {
  const payload = JSON.stringify({ claim: claimText, sentence_context: sentenceContext }, null, 2);

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

    return {
      core: normalizedCore,
      modifiers: allModifiers,
      recursiveSubject: typeof c.subject !== "string" ? c.subject : undefined,
      recursiveObject: typeof c.object !== "string" ? c.object : undefined,
    };
  } catch (err) {
    console.error("[graphFromClaim] LLM error:", err);
    if (isLlmUnavailable(err)) throw err;
    return null;
  }
}
