import type { AtomCandidate, AtomMatch, PositionThresholds, SearchFn } from "./types.js";
import {
  COMPARATIVE_RE,
  CONDITION_RE,
  NEGATION_RE,
  MODAL_CHECK_RE,
} from "../helpers/rules/extractionRules.js";

export function canonicalize(s: string): string {
  return s
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;:!?]+$/, "")
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

export function canonicalizeForMatch(s: string): string {
  return canonicalize(s).replace(/^(the|a|an)\s+/i, "");
}

export function preservesPredicateStructure(raw: string, matched: string): boolean {
  const canon = (s: string) => s.toLowerCase()
    .replace(/\bcan't\b/g, "cannot")
    .replace(/\bwon't\b/g, "will not")
    .replace(/n't\b/g, " not");

  const r = canon(raw), m = canon(matched);

  const hasComparative = (s: string) => COMPARATIVE_RE.test(s);
  const hasCondition = (s: string) => CONDITION_RE.test(s);
  const hasNegation = (s: string) => NEGATION_RE.test(s);
  const hasModal = (s: string) => MODAL_CHECK_RE.test(s);

  if (hasComparative(r) !== hasComparative(m)) return false;
  if (hasCondition(r)   !== hasCondition(m))   return false;
  if (hasNegation(r)    !== hasNegation(m))    return false;
  if (hasModal(r)       !== hasModal(m))       return false;
  return true;
}

const THRESHOLDS: Record<AtomMatch["position"], PositionThresholds> = {
  subject:   { high: 800, low: 250 },
  predicate: { high: 900, low: 300 },
  object:    { high: 750, low: 200 },
};

function tokenize(s: string): Set<string> {
  return new Set(canonicalizeForMatch(s).split(/\s+/).filter(Boolean));
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const t of a) if (b.has(t)) count++;
  return count;
}

export function scoreCandidate(rawLabel: string, candidate: AtomCandidate): number {
  const rawCanon = canonicalizeForMatch(rawLabel);
  const candCanon = canonicalizeForMatch(candidate.label);

  if (!rawCanon || !candCanon) return 0;

  if (rawCanon === candCanon) return 1000;

  if (rawCanon.includes(candCanon) || candCanon.includes(rawCanon)) {

    const ratio = Math.min(rawCanon.length, candCanon.length) / Math.max(rawCanon.length, candCanon.length);
    return Math.round(500 * ratio);
  }

  const rawTokens = tokenize(rawLabel);
  const candTokens = tokenize(candidate.label);
  const overlap = tokenOverlap(rawTokens, candTokens);
  let score = overlap * 200;

  if ((candidate.marketCap ?? 0) > 0) {
    score += Math.log10(Math.max(1, candidate.marketCap!)) * 5;
  }
  if ((candidate.holders ?? 0) > 0) {
    score += Math.log10(Math.max(1, candidate.holders!)) * 3;
  }

  return Math.round(score);
}

function pluralVariants(label: string): string[] {
  const c = canonicalize(label);
  const variants = [c];

  if (c.endsWith("ies")) {
    variants.push(c.slice(0, -3) + "y");
  } else if (c.endsWith("es")) {
    variants.push(c.slice(0, -2));
  } else if (c.endsWith("s") && !c.endsWith("ss")) {
    variants.push(c.slice(0, -1));
  } else {
    variants.push(c + "s");
    if (c.endsWith("y")) {
      variants.push(c.slice(0, -1) + "ies");
    }
  }

  return variants;
}

export function consensusCompare(a: AtomCandidate, b: AtomCandidate): number {
  const hA = a.holders ?? 0, hB = b.holders ?? 0;
  if (hB !== hA) return hB - hA;
  const mcA = a.marketCap ?? 0, mcB = b.marketCap ?? 0;
  if (mcB !== mcA) return mcB - mcA;
  return a.label.localeCompare(b.label);
}

export function compareScoredCandidates(
  a: { candidate: AtomCandidate; score: number },
  b: { candidate: AtomCandidate; score: number },
): number {
  if (b.score !== a.score) return b.score - a.score;
  return consensusCompare(a.candidate, b.candidate);
}

export function findDuplicate(
  rawLabel: string,
  candidates: AtomCandidate[],
): AtomCandidate | null {
  const variants = pluralVariants(rawLabel);
  const matches: AtomCandidate[] = [];

  for (const candidate of candidates) {
    const candCanon = canonicalize(candidate.label);
    const candForMatch = canonicalizeForMatch(candidate.label);
    let found = false;

    for (const v of variants) {
      if (v === candCanon || v === candForMatch) { found = true; break; }
    }

    if (!found) {
      const candVariants = pluralVariants(candidate.label);
      outer: for (const rv of variants) {
        for (const cv of candVariants) {
          if (rv === cv) { found = true; break outer; }
        }
      }
    }

    if (found) matches.push(candidate);
  }

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  matches.sort(consensusCompare);
  return matches[0];
}

export class SearchCache {
  private cache = new Map<string, AtomCandidate[]>();

  private inflight = new Map<string, Promise<AtomMatch>>();

  private decisions = new Map<string, AtomMatch>();

  async search(searchFn: SearchFn, label: string, limit: number): Promise<AtomCandidate[]> {
    const key = canonicalize(label);
    if (this.cache.has(key)) return this.cache.get(key)!;

    const results = await searchFn(label, limit);

    if (results.length > 0) {
      this.cache.set(key, results);
    }
    return results;
  }

  private decisionKey(rawLabel: string, position: AtomMatch["position"]): string {
    return `${canonicalize(rawLabel)}|${position}`;
  }

  getDecision(rawLabel: string, position: AtomMatch["position"]): AtomMatch | undefined {
    return this.decisions.get(this.decisionKey(rawLabel, position));
  }

  setDecision(rawLabel: string, position: AtomMatch["position"], match: AtomMatch): void {
    this.decisions.set(this.decisionKey(rawLabel, position), match);
  }

  getInflight(rawLabel: string, position: AtomMatch["position"]): Promise<AtomMatch> | undefined {
    return this.inflight.get(this.decisionKey(rawLabel, position));
  }

  setInflight(rawLabel: string, position: AtomMatch["position"], promise: Promise<AtomMatch>): void {
    this.inflight.set(this.decisionKey(rawLabel, position), promise);
  }

  clearInflight(rawLabel: string, position: AtomMatch["position"]): void {
    this.inflight.delete(this.decisionKey(rawLabel, position));
  }

  clear() {
    this.cache.clear();
    this.decisions.clear();
    this.inflight.clear();
  }
}

export type MatchOptions = {
  searchFn: SearchFn;
  cache: SearchCache;

  llmMatcher?: (
    rawLabel: string,
    claimContext: string,
    candidates: AtomCandidate[],
    position: AtomMatch["position"],
  ) => Promise<AtomMatch>;
  searchLimit?: number;
};

export async function matchAtom(
  rawLabel: string,
  position: AtomMatch["position"],
  claimContext: string,
  opts: MatchOptions,
): Promise<AtomMatch> {
  const { searchFn, cache, llmMatcher, searchLimit = 10 } = opts;

  const cached = cache.getDecision(rawLabel, position);
  if (cached) {
    return { ...cached, decisionPath: "cache_hit" };
  }

  const inflight = cache.getInflight(rawLabel, position);
  if (inflight) {
    return inflight;
  }

  const promise = matchAtomInner(rawLabel, position, claimContext, searchFn, cache, llmMatcher, searchLimit);
  cache.setInflight(rawLabel, position, promise);
  try {
    const result = await promise;
    cache.setDecision(rawLabel, position, result);
    return result;
  } finally {
    cache.clearInflight(rawLabel, position);
  }
}

function validateLlmResult(
  result: AtomMatch,
  candidates: AtomCandidate[],
  rawLabel: string,
  position: AtomMatch["position"],
  deterministicBest: { candidate: AtomCandidate; score: number } | null,
): AtomMatch {

  const alts = result.alternatives;

  if (result.choice === "new") return result;

  const matchedCandidate = result.termId ? candidates.find((c) => c.termId === result.termId) : null;
  if (result.termId && matchedCandidate) {
    if (position === "predicate" && !preservesPredicateStructure(rawLabel, matchedCandidate.label)) {
      return { position, rawLabel, choice: "new", termId: null, label: rawLabel, confidence: 0.8, rationale: "Structure mismatch override", decisionPath: "llm_review", alternatives: alts };
    }

    return { ...result, label: matchedCandidate.label };
  }

  if (result.label) {
    const byLabel = candidates.find(
      (c) => canonicalizeForMatch(c.label) === canonicalizeForMatch(result.label),
    );
    if (byLabel) {
      if (position === "predicate" && !preservesPredicateStructure(rawLabel, byLabel.label)) {

      } else {
        return { ...result, termId: byLabel.termId, label: byLabel.label };
      }
    }
  }

  const threshold = THRESHOLDS[position];
  if (deterministicBest && deterministicBest.score >= threshold.high) {
    if (position === "predicate" && !preservesPredicateStructure(rawLabel, deterministicBest.candidate.label)) {

    } else {
      return {
        position,
        rawLabel,
        choice: "existing",
        termId: deterministicBest.candidate.termId,
        label: deterministicBest.candidate.label,
        confidence: deterministicBest.score / 1000,
        decisionPath: "llm_review",
        alternatives: alts,
      };
    }
  }

  return {
    position,
    rawLabel,
    choice: "new",
    termId: null,
    label: rawLabel,
    confidence: 0.3,
    rationale: "LLM hallucinated termId; fallback to new",
    decisionPath: "llm_review",
    alternatives: alts,
  };
}

async function matchAtomInner(
  rawLabel: string,
  position: AtomMatch["position"],
  claimContext: string,
  searchFn: SearchFn,
  cache: SearchCache,
  llmMatcher: MatchOptions["llmMatcher"],
  searchLimit: number,
): Promise<AtomMatch> {

  let candidates: AtomCandidate[];
  try {
    candidates = await cache.search(searchFn, rawLabel, searchLimit);
  } catch {

    return {
      position,
      rawLabel,
      choice: "new",
      termId: null,
      label: rawLabel,
      confidence: 0,
      decisionPath: "search_unavailable",
      alternatives: [],
    };
  }

  if (candidates.length === 0) {
    return {
      position,
      rawLabel,
      choice: "new",
      termId: null,
      label: rawLabel,
      confidence: 0.5,
      decisionPath: "no_candidates",
      alternatives: [],
    };
  }

  const scored = candidates
    .map((c) => ({ candidate: c, score: scoreCandidate(rawLabel, c) }))
    .sort(compareScoredCandidates);

  const best = scored[0];
  const thresholds = THRESHOLDS[position];
  const topAlts = scored.slice(0, 3).map((s) => s.candidate);

  const dup = findDuplicate(rawLabel, candidates);
  if (dup) {

    if (position === "predicate" && !preservesPredicateStructure(rawLabel, dup.label)) {

    } else {
      return {
        position,
        rawLabel,
        choice: "existing",
        termId: dup.termId,
        label: dup.label,
        confidence: 1,
        decisionPath: "anti_dup",
        alternatives: topAlts,
      };
    }
  }

  if (best.score >= thresholds.high) {
    if (position === "predicate" && !preservesPredicateStructure(rawLabel, best.candidate.label)) {

    } else {
      return {
        position,
        rawLabel,
        choice: "existing",
        termId: best.candidate.termId,
        label: best.candidate.label,
        confidence: Math.min(1, best.score / 1000),
        decisionPath: "high_score",
        alternatives: topAlts,
      };
    }
  }

  if (best.score < thresholds.low) {
    if (llmMatcher) {
      const llmResult = await llmMatcher(rawLabel, claimContext, scored.slice(0, 5).map((s) => s.candidate), position);
      const validated = validateLlmResult(llmResult, candidates, rawLabel, position, best);
      return { ...validated, decisionPath: validated.decisionPath ?? "llm_review", alternatives: validated.alternatives ?? topAlts };
    }

    return {
      position,
      rawLabel,
      choice: "new",
      termId: null,
      label: rawLabel,
      confidence: 0.3,
      decisionPath: "no_llm_fallback",
      alternatives: topAlts,
    };
  }

  if (llmMatcher) {
    const llmResult = await llmMatcher(rawLabel, claimContext, scored.slice(0, 5).map((s) => s.candidate), position);
    const validated = validateLlmResult(llmResult, candidates, rawLabel, position, best);
    return { ...validated, decisionPath: validated.decisionPath ?? "llm_review", alternatives: validated.alternatives ?? topAlts };
  }

  if (position === "predicate" && !preservesPredicateStructure(rawLabel, best.candidate.label)) {
    return {
      position,
      rawLabel,
      choice: "new",
      termId: null,
      label: rawLabel,
      confidence: 0.3,
      decisionPath: "no_llm_fallback",
      alternatives: topAlts,
    };
  }
  return {
    position,
    rawLabel,
    choice: "existing",
    termId: best.candidate.termId,
    label: best.candidate.label,
    confidence: best.score / 1000,
    decisionPath: "no_llm_fallback",
    alternatives: topAlts,
  };
}

export async function matchTriple(
  triple: { subject: string; predicate: string; object: string },
  claimContext: string,
  opts: MatchOptions,
): Promise<{ subject: AtomMatch; predicate: AtomMatch; object: AtomMatch }> {
  const [subject, predicate, object] = await Promise.all([
    matchAtom(triple.subject, "subject", claimContext, opts),
    matchAtom(triple.predicate, "predicate", claimContext, opts),
    matchAtom(triple.object, "object", claimContext, opts),
  ]);
  return { subject, predicate, object };
}
