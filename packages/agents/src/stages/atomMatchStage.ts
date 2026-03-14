

import type { LanguageModel } from "ai";
import type { ExtractionResult, ExtractionOptions } from "../types.js";
import type { AtomCandidate, AtomMatch } from "../search/types.js";
import { matchTriple, SearchCache, preservesPredicateStructure } from "../search/atomSearch.js";
import { LLMPool, withLightFallback } from "../utils/concurrency.js";

export type AtomMatchDeps = {
  runAtomMatcher: (model: LanguageModel, rawLabel: string, claimContext: string, candidates: AtomCandidate[], position: AtomMatch["position"]) => Promise<AtomMatch>;
  getGroqModel: () => LanguageModel;
  getGroqModelLight: () => LanguageModel;
};

export async function runAtomMatchStage(
  perSegment: ExtractionResult["perSegment"],
  searchFn: NonNullable<ExtractionOptions["searchFn"]>,
  deps: AtomMatchDeps,
): Promise<{ llmCalls: number }> {
  let llmCalls = 0;
  const searchCache = new SearchCache();
  const llmPool = new LLMPool(3);

  const llmMatcher = async (
    rawLabel: string,
    claimContext: string,
    candidates: AtomCandidate[],
    position: AtomMatch["position"],
  ): Promise<AtomMatch> => {
    llmCalls++;
    return llmPool.run(() =>
      withLightFallback(
        (m) => deps.runAtomMatcher(m, rawLabel, claimContext, candidates, position),
        deps.getGroqModelLight(), deps.getGroqModel(), "atom-matcher",
      ),
    );
  };

  const matchOpts = { searchFn, cache: searchCache, llmMatcher };

  const matchPromises: Array<{
    segIdx: number;
    claimIdx: number;
    promise: Promise<{ subject: AtomMatch; predicate: AtomMatch; object: AtomMatch }>;
  }> = [];

  for (let si = 0; si < perSegment.length; si++) {
    for (let ci = 0; ci < perSegment[si].claims.length; ci++) {
      const c = perSegment[si].claims[ci];
      if (!c.triple) continue;
      matchPromises.push({
        segIdx: si,
        claimIdx: ci,
        promise: matchTriple(
          { subject: c.triple.subject, predicate: c.triple.predicate, object: c.triple.object },
          c.claim,
          matchOpts,
        ),
      });
    }
  }

  const results = await Promise.allSettled(matchPromises.map((mp) => mp.promise));

  for (let ri = 0; ri < matchPromises.length; ri++) {
    const result = results[ri];
    if (result.status !== "fulfilled") {
      continue;
    }
    const { segIdx, claimIdx } = matchPromises[ri];
    const matches = result.value;
    const triple = perSegment[segIdx].claims[claimIdx].triple;
    if (!triple) continue;

    triple.subjectTermId = matches.subject.termId;
    triple.predicateTermId = matches.predicate.termId;
    triple.objectTermId = matches.object.termId;
    triple.subjectConfidence = matches.subject.confidence;
    triple.predicateConfidence = matches.predicate.confidence;
    triple.objectConfidence = matches.object.confidence;
    triple.subjectMatchedLabel = matches.subject.choice === "existing" ? matches.subject.label : null;
    triple.predicateMatchedLabel = matches.predicate.choice === "existing" ? matches.predicate.label : null;
    triple.objectMatchedLabel = matches.object.choice === "existing" ? matches.object.label : null;

    const buildMeta = (m: AtomMatch) => {
      const selected = m.termId ? (m.alternatives ?? []).find((c) => c.termId === m.termId) : null;
      return {
        rationale: m.rationale ?? null,
        decisionPath: m.decisionPath ?? null,
        alternatives: (m.alternatives ?? []).slice(0, 3).map((c) => ({
          termId: c.termId, label: c.label,
          holders: c.holders, shares: c.shares, marketCap: c.marketCap, sharePrice: c.sharePrice,
        })),
        selectedHolders: selected?.holders ?? null,
        selectedShares: selected?.shares ?? null,
        selectedMarketCap: selected?.marketCap ?? null,
        selectedSharePrice: selected?.sharePrice ?? null,
      };
    };
    triple.subjectMeta = buildMeta(matches.subject);
    triple.predicateMeta = buildMeta(matches.predicate);
    triple.objectMeta = buildMeta(matches.object);

    if (matches.predicate.choice === "existing" && matches.predicate.label) {
      if (!preservesPredicateStructure(triple.predicate, matches.predicate.label)) {
        triple.predicateTermId = null;
        triple.predicateConfidence = undefined;
        triple.predicateMatchedLabel = null;
        if (triple.predicateMeta) triple.predicateMeta.alternatives = [];
      }
    }

  }

  return { llmCalls };
}
