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

export type MeaningPreservation = "strict_equivalent" | "preserve" | "ambiguous" | "reject";

const VERB_SUFFIX_RE = /^(.+?)(s|es|ed|ing)$/;

function stemVerb(word: string): string {
  const m = word.match(VERB_SUFFIX_RE);
  if (!m) return word;
  const base = m[1];
  const suffix = m[2];
  if (suffix === "es" && (base.endsWith("sh") || base.endsWith("ch") || base.endsWith("x") || base.endsWith("z") || base.endsWith("ss"))) return base;
  if (suffix === "s") return base;
  if (suffix === "ed") return base.endsWith("e") ? base : base;
  if (suffix === "ing") return base;
  return word;
}

function areSameVerbForm(a: string, b: string): boolean {
  const wordsA = a.split(/\s+/);
  const wordsB = b.split(/\s+/);
  if (wordsA.length !== wordsB.length) return false;
  return wordsA.every((wA, i) => {
    const wB = wordsB[i];
    if (wA === wB) return true;
    return stemVerb(wA) === stemVerb(wB);
  });
}

const FREQUENCY_ADVERB_RE = /\b(usually|always|never|often|sometimes|rarely|frequently|seldom|generally|typically|occasionally|commonly|mostly|hardly|barely|scarcely)\b/i;

function getFrequencyAdverbs(s: string): string[] {
  const matches: string[] = [];
  const re = new RegExp(FREQUENCY_ADVERB_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) matches.push(m[0].toLowerCase());
  return matches;
}

export function checkMeaningPreservation(
  rawLabel: string,
  candidateLabel: string,
  position: AtomMatch["position"],
  _claimContext?: string,
): MeaningPreservation {
  const rawCanon = canonicalizeForMatch(rawLabel);
  const candCanon = canonicalizeForMatch(candidateLabel);

  if (!rawCanon || !candCanon) return "reject";

  // --- strict_equivalent: trivial identity ---
  // Case, whitespace, accents, articles → already handled by canonicalizeForMatch
  if (rawCanon === candCanon) return "strict_equivalent";

  // Plural variants — for multi-word labels, always safe.
  // For single-word labels where only difference is simple s/es suffix,
  // this could be noun plural OR verb conjugation — only strict_equivalent
  // for predicates (where conjugation is expected).
  const rawVariants = pluralVariants(rawLabel);
  const candVariants = pluralVariants(candidateLabel);
  const rawWordCount = rawCanon.split(/\s+/).length;
  const candWordCount = candCanon.split(/\s+/).length;
  const isSingleWord = rawWordCount === 1 && candWordCount === 1;

  let pluralMatch = false;
  for (const rv of rawVariants) {
    for (const cv of candVariants) {
      if (rv === cv) { pluralMatch = true; break; }
    }
    if (pluralMatch) break;
  }

  if (pluralMatch) {
    // Multi-word → always strict_equivalent (noun plurals in phrases)
    // Single-word + predicate → strict_equivalent (verb conjugation OK)
    // Single-word + ies/y pattern → strict_equivalent (clearly noun: policy/policies)
    // Single-word + simple s + subject/object → ambiguous (could be verb)
    if (!isSingleWord || position === "predicate") {
      return "strict_equivalent";
    }
    // Check if it's clearly a noun plural pattern
    const rc = canonicalize(rawLabel);
    const cc = canonicalize(candidateLabel);
    // ies/y pattern: policy/policies
    const isClearNounPlural =
      (rc.endsWith("ies") && cc.endsWith("y")) ||
      (cc.endsWith("ies") && rc.endsWith("y")) ||
      (rc.endsWith("es") && !rc.endsWith("ses") && cc === rc.slice(0, -2)) ||
      (cc.endsWith("es") && !cc.endsWith("ses") && rc === cc.slice(0, -2));
    if (isClearNounPlural) return "strict_equivalent";

    // Noun suffix heuristic: words ending in common noun suffixes
    // are clearly nouns, not verbs — plural is safe
    const NOUN_SUFFIX_RE = /(?:tion|sion|ment|ness|ity|ism|ance|ence|ure|age|dom|ship|ing|ology|ics)s?$/i;
    const shorter = rc.length < cc.length ? rc : cc;
    if (NOUN_SUFFIX_RE.test(shorter)) return "strict_equivalent";

    // Simple s-only difference on single word subject/object → ambiguous
    // (could be verb conjugation: "reduces"/"reduce")
  }

  // Verb conjugation → strict_equivalent only for predicates
  if (position === "predicate" && areSameVerbForm(rawCanon, candCanon)) {
    return "strict_equivalent";
  }

  // --- reject: predicate structure mismatch ---
  if (!preservesPredicateStructure(rawLabel, candidateLabel)) {
    return "reject";
  }

  // Frequency adverb mismatch → reject
  const rawAdverbs = getFrequencyAdverbs(rawLabel);
  const candAdverbs = getFrequencyAdverbs(candidateLabel);
  if (rawAdverbs.length !== candAdverbs.length ||
      !rawAdverbs.every((a, i) => a === candAdverbs[i])) {
    return "reject";
  }

  // --- reject: strict subset (one is fully contained but much shorter) ---
  const rawTokens = tokenize(rawLabel);
  const candTokens = tokenize(candidateLabel);
  const overlap = tokenOverlap(rawTokens, candTokens);
  const minSize = Math.min(rawTokens.size, candTokens.size);
  const maxSize = Math.max(rawTokens.size, candTokens.size);

  // One label is a proper subset of the other → reject (too generic or too specific)
  if (overlap === minSize && minSize < maxSize && maxSize >= 2) {
    return "reject";
  }

  // --- reject: semantic drift (candidate has many foreign tokens) ---
  // Tokens in candidate that are NOT in raw label
  let foreignCount = 0;
  for (const t of candTokens) if (!rawTokens.has(t)) foreignCount++;
  // If majority of candidate tokens are foreign → reject
  if (candTokens.size >= 2 && foreignCount > candTokens.size / 2) {
    return "reject";
  }

  // --- preserve vs ambiguous ---
  // High overlap ratio → preserve; low overlap → ambiguous
  if (maxSize === 0) return "ambiguous";
  const overlapRatio = overlap / maxSize;

  // If all tokens match but different order/form → preserve
  if (overlapRatio >= 0.8) return "preserve";

  // Some overlap but not enough certainty → ambiguous
  if (overlapRatio > 0) return "ambiguous";

  // No token overlap at all → reject
  return "reject";
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

export function scoreCandidateWithContext(
  rawLabel: string,
  candidate: AtomCandidate,
  claimContext?: string,
): number {
  let score = scoreCandidate(rawLabel, candidate);
  if (!claimContext || score === 0) return score;

  const rawTokens = tokenize(rawLabel);
  const candTokens = tokenize(candidate.label);
  const contextTokens = tokenize(claimContext);

  for (const t of candTokens) {
    if (!rawTokens.has(t)) {
      if (contextTokens.has(t)) {
        score += 30; // token found in context → relevance bonus
      } else {
        score -= 50; // foreign token absent from raw AND context → drift malus
      }
    }
  }

  return Math.max(0, Math.round(score));
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
      if (!(position === "predicate" && !preservesPredicateStructure(rawLabel, byLabel.label))) {
        return { ...result, termId: byLabel.termId, label: byLabel.label };
      }
    }
  }

  const threshold = THRESHOLDS[position];
  if (deterministicBest && deterministicBest.score >= threshold.high) {
    if (!(position === "predicate" && !preservesPredicateStructure(rawLabel, deterministicBest.candidate.label))) {
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
    .map((c) => ({ candidate: c, score: scoreCandidateWithContext(rawLabel, c, claimContext || undefined) }))
    .sort(compareScoredCandidates);

  const topAlts = scored.slice(0, 3).map((s) => s.candidate);
  const thresholds = THRESHOLDS[position];

  // Stage 0: strict_equivalent among ALL candidates — pick most consensual.
  const strictGroup: AtomCandidate[] = [];
  let isAntiDup = false;
  for (const c of candidates) {
    const mp = checkMeaningPreservation(rawLabel, c.label, position);
    if (mp === "strict_equivalent") {
      strictGroup.push(c);
    }
  }

  if (strictGroup.length === 0) {
    // Check anti_dup (plural variant match) as fallback for strict_equivalent
    const dup = findDuplicate(rawLabel, candidates);
    if (dup && preservesPredicateStructure(rawLabel, dup.label)) {
      strictGroup.push(dup);
      isAntiDup = true;
    }
  }

  if (strictGroup.length > 0) {
    strictGroup.sort(consensusCompare);
    const winner = strictGroup[0];
    return {
      position,
      rawLabel,
      choice: "existing",
      termId: winner.termId,
      label: winner.label,
      confidence: 1,
      decisionPath: isAntiDup ? "anti_dup" : "strict_equivalent",
      alternatives: topAlts,
    };
  }

  // Classify remaining candidates (strict_equivalent already handled above)
  const preserveCandidates: { candidate: AtomCandidate; score: number }[] = [];
  const ambiguousCandidates: { candidate: AtomCandidate; score: number }[] = [];

  for (const s of scored) {
    const mp = checkMeaningPreservation(rawLabel, s.candidate.label, position, claimContext);
    if (mp === "strict_equivalent") continue; // already handled above
    if (mp === "reject") continue; // eliminated
    if (mp === "preserve") preserveCandidates.push(s);
    if (mp === "ambiguous") ambiguousCandidates.push(s);
  }

  // Stage 2+3: high-score preserve candidates
  if (preserveCandidates.length > 0) {
    const bestPreserve = preserveCandidates[0]; // already sorted by score desc
    if (bestPreserve.score >= thresholds.high) {
      return {
        position,
        rawLabel,
        choice: "existing",
        termId: bestPreserve.candidate.termId,
        label: bestPreserve.candidate.label,
        confidence: Math.min(1, bestPreserve.score / 1000),
        decisionPath: "high_score",
        alternatives: topAlts,
      };
    }
  }

  // Stage 4: LLM for ambiguous candidates
  const llmCandidates = [...preserveCandidates, ...ambiguousCandidates];
  if (llmCandidates.length > 0 && llmMatcher) {
    const llmResult = await llmMatcher(
      rawLabel, claimContext,
      llmCandidates.slice(0, 5).map((s) => s.candidate),
      position,
    );
    const best = preserveCandidates[0] ?? ambiguousCandidates[0] ?? null;
    const validated = validateLlmResult(llmResult, candidates, rawLabel, position, best);
    return { ...validated, decisionPath: validated.decisionPath ?? "llm_review", alternatives: validated.alternatives ?? topAlts };
  }

  // No LLM available — create new atom
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
