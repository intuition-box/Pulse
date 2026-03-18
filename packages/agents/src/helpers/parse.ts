import type { FlatTriple, Conditional } from "../types.js";
import { trackFallback } from "./fallbackTracker.js";
import {
  REPORTING_VERBS,
  PROBABLE_VERB_RE,
  TEMPORAL_SINCE_RE,
  COMPOUND_CONDITIONAL_KW,
  COPULA_RE,
  MODAL_EXTRACT_RE,
  TRANSITIVE_RE,
  FILLER_SUBJECTS_RE,
  SUB_PROPOSITION_MIN_WORDS,
  SUB_PROPOSITION_MAX_WORDS,
  CAUSAL_BEFORE_MIN_WORDS,
} from "./rules/extractionRules.js";

export function isReportingVerb(word: string): boolean {
  return REPORTING_VERBS.has(word.toLowerCase());
}

export function looksLikeProposition(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length >= 3 && PROBABLE_VERB_RE.test(text);
}

function looksLikeMetaProposition(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length >= 2 && PROBABLE_VERB_RE.test(text);
}

export function parseMetaClaim(claim: string): { source: string; verb: string; proposition: string } | null {
  const c = claim.trim().replace(/\.$/, "");

  const m1 = c.match(/^(.+?)\s+([a-z]+)\s+that\s+(.+)$/i);
  if (m1) {
    const verb = m1[2].trim();
    if (!REPORTING_VERBS.has(verb.toLowerCase())) return null;
    const proposition = m1[3].trim();
    if (!proposition) return null;
    return { source: m1[1].trim(), verb, proposition };
  }

  const m2 = c.match(/^(.+?)\s+([a-z]+)\s+(.+)$/i);
  if (!m2) return null;
  const verb = m2[2].trim();
  if (!REPORTING_VERBS.has(verb.toLowerCase())) return null;
  const remainder = m2[3].trim();
  if (!remainder) return null;

  const subProp = tryExtractSubProposition(remainder);
  if (subProp) return { source: m2[1].trim(), verb, proposition: remainder };
  if (looksLikeMetaProposition(remainder)) return { source: m2[1].trim(), verb, proposition: remainder };

  return null;
}

export function parseCausal(text: string): { mainText: string; reasonText: string; marker: "because" | "since" } | null {
  const match = /\b(because|since)\b/i.exec(text);
  if (!match) return null;
  const marker = match[1].toLowerCase() as "because" | "since";
  const markerIndex = match.index;
  if (marker === "since" && TEMPORAL_SINCE_RE.test(text.slice(markerIndex))) return null;
  const before = text.slice(0, markerIndex).trim().replace(/[,;:]\s*$/, "").trim();
  const after = text.slice(markerIndex + match[0].length).trim().replace(/\.\s*$/, "");
  if (before.split(/\s+/).filter(Boolean).length < CAUSAL_BEFORE_MIN_WORDS) return null;
  if (!after || after.split(/\s+/).filter(Boolean).length < 2) return null;
  return { mainText: before, reasonText: after, marker };
}

const COMPOUND_KW = Object.keys(COMPOUND_CONDITIONAL_KW).sort((a, b) => b.length - a.length);

function parseConditionalKeyword(value: string): Conditional["kw"] | null {
  const lower = value.toLowerCase();
  return lower === "if" || lower === "unless" || lower === "when" ? lower : null;
}

export function parseConditional(text: string): Conditional | null {
  const s = text.trim().replace(/\.$/, "");

  for (const ckw of COMPOUND_KW) {

    const leadRe = new RegExp(`^(${ckw})\\s+(.+?),\\s+(.+)$`, "i");
    const leadM = s.match(leadRe);
    if (leadM) {
      const kw = COMPOUND_CONDITIONAL_KW[ckw];
      return { kw, condText: leadM[2].trim(), mainText: leadM[3].trim(), compoundKw: ckw };
    }

    const trailRe = new RegExp(`^(.+?)\\s+(${ckw})\\s+(.+)$`, "i");
    const trailM = s.match(trailRe);
    if (trailM) {
      const kw = COMPOUND_CONDITIONAL_KW[ckw];
      return { kw, condText: trailM[3].trim(), mainText: trailM[1].trim(), compoundKw: ckw };
    }
  }

  let m = s.match(/^(If|Unless|When)\s+(.+?),\s+(.+)$/i);
  if (m) {
    const kw = parseConditionalKeyword(m[1]);
    if (!kw) return null;
    return { kw, condText: m[2].trim(), mainText: m[3].trim() };
  }

  m = s.match(/^(If|Unless|When)\s+(.+?)\s+then\s+(.+)$/i);
  if (m) {
    const kw = parseConditionalKeyword(m[1]);
    if (!kw) return null;
    return { kw, condText: m[2].trim(), mainText: m[3].trim() };
  }

  m = s.match(/^(.+?)\s+(if|unless|when)\s+(.+)$/i);
  if (m) {
    const kw = parseConditionalKeyword(m[2]);
    if (!kw) return null;
    return { kw, condText: m[3].trim(), mainText: m[1].trim() };
  }

  return null;
}

export function tryExtractSubProposition(value: string): FlatTriple | null {
  const trimmed = value.trim();
  const words = trimmed.split(/\s+/);
  if (words.length < SUB_PROPOSITION_MIN_WORDS || words.length > SUB_PROPOSITION_MAX_WORDS) return null;

  const modalIntransitive = trimmed.match(/^(.+?)\s+(can|should|must|will|may|might|could|would)\s+([a-z][a-z-]*)$/i);
  if (modalIntransitive) {
    const subject = modalIntransitive[1].trim();
    if (FILLER_SUBJECTS_RE.test(subject)) return null;
    const predicate = modalIntransitive[2].trim();
    const object = modalIntransitive[3].trim();
    trackFallback("tryExtractSubProposition");
    return { subject, predicate, object };
  }

  const modal = trimmed.match(MODAL_EXTRACT_RE);
  if (modal) {
    const subject = modal[1].trim();
    if (FILLER_SUBJECTS_RE.test(subject)) return null;
    const predicate = `${modal[2].trim()} ${modal[3].trim()}`;
    const object = modal[4].trim();
    if (object.toLowerCase().startsWith("that ")) return null;
    trackFallback("tryExtractSubProposition");
    return { subject, predicate, object };
  }

  const trans = trimmed.match(TRANSITIVE_RE);
  if (trans) {
    const subject = trans[1].trim();
    if (FILLER_SUBJECTS_RE.test(subject)) return null;
    const predicate = trans[2].trim();
    const object = trans[3].trim();
    if (object.toLowerCase().startsWith("that ")) return null;
    trackFallback("tryExtractSubProposition");
    return { subject, predicate, object };
  }

  const copula = trimmed.match(COPULA_RE);
  if (copula) {
    const subject = copula[1].trim();
    if (FILLER_SUBJECTS_RE.test(subject)) return null;
    const predicate = copula[2].trim();
    const object = copula[3].trim();
    if (object.toLowerCase().startsWith("that ")) return null;
    trackFallback("tryExtractSubProposition");
    return { subject, predicate, object };
  }

  return null;
}

