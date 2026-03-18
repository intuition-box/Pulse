

import type { LanguageModel } from "ai";
import type { NestedEdge, TermRef } from "../core.js";
import type { FlatTriple } from "../types.js";
import type { ClaimResult } from "../helpers/claimProcessor.js";
import { stableKeyFromEdge } from "../core.js";
import { termAtom, termTriple, pushEdge } from "../helpers/termRef.js";
import { withLightFallback } from "../utils/concurrency.js";

export type RelationDeps = {
  runRelationLinking: (model: LanguageModel, payload: string) => Promise<{ relations: Array<{ from: number; to: number; predicate: string }> }>;
  getGroqModel: () => LanguageModel;
  getGroqModelLight: () => LanguageModel;
};

import {
  RELATION_MARKERS_RE,
  ALLOWED_RELATION_PREDICATES,
  CAUSAL_PREDS,
  CAUSAL_SENTENCE_RE,
} from "../helpers/rules/extractionRules.js";

export async function runRelationStage(
  claims: ClaimResult[],
  selectedSentence: string,
  nested: NestedEdge[],
  existingNestedKeys: Set<string>,
  deps: RelationDeps,
): Promise<{ llmCalls: number }> {
  let llmCalls = 0;
  const nestedCountBefore = nested.length;

  const claimsByGroup = new Map<number, typeof claims>();
  for (const c of claims) {
    if (c.isMeta) continue;
    const g = claimsByGroup.get(c.group) || [];
    g.push(c);
    claimsByGroup.set(c.group, g);
  }

  for (const [, groupClaims] of claimsByGroup) {
    const idxToTriple = new Map<number, FlatTriple & { stableKey: string }>();
    for (const c of groupClaims) {
      if (c.triple) idxToTriple.set(c.index, c.triple);
    }

    if (idxToTriple.size < 2 || !RELATION_MARKERS_RE.test(selectedSentence)) continue;

    const relInput = {
      sentence: selectedSentence,
      claims: groupClaims
        .filter((c) => c.triple)
        .map((c) => ({
          index: c.index,
          text: c.claim,
          core_triple: `(${c.triple!.subject} | ${c.triple!.predicate} | ${c.triple!.object})`,
        })),
    };

    try {
      llmCalls++;
      const relOut = await withLightFallback(
        (m) => deps.runRelationLinking(m, JSON.stringify(relInput)),
        deps.getGroqModelLight(), deps.getGroqModel(), "relation-linking",
      );

      if (Array.isArray(relOut.relations)) {
        for (const r of relOut.relations) {
          const normalizedPred = String(r.predicate).trim().toLowerCase();
          if (!ALLOWED_RELATION_PREDICATES.has(normalizedPred)) continue;
          const from = idxToTriple.get(r.from);
          const to = idxToTriple.get(r.to);
          if (!from || !to) continue;

          if (normalizedPred === "if" || normalizedPred === "unless" || normalizedPred === "when") {
            const maybe = stableKeyFromEdge({
              from: termTriple(from),
              predicate: termAtom(normalizedPred),
              to: termTriple(to),
            });
            if (existingNestedKeys.has(maybe)) continue;
          }

          pushEdge(nested, existingNestedKeys, {
            kind: "relation",
            origin: "agent",
            predicate: normalizedPred,
            subject: termTriple(from),
            object: termTriple(to),
          });
        }
      }
    } catch {

    }
  }

  const segmentTripleKeys = new Set(
    claims.filter((c) => c.triple).map((c) => c.triple!.stableKey),
  );

  function isSegmentTriple(term: TermRef): boolean {
    return term.type === "triple" && segmentTripleKeys.has(term.tripleKey);
  }

  const hadCausalEdge =

    nested.slice(nestedCountBefore).some((e) => CAUSAL_PREDS.has(e.predicate)) ||

    nested.slice(0, nestedCountBefore).some((e) =>
      CAUSAL_PREDS.has(e.predicate) &&
      (isSegmentTriple(e.subject) || isSegmentTriple(e.object)),
    );

  const hasCausalSignal =
    CAUSAL_SENTENCE_RE.test(selectedSentence) ||
    claims.some((c) => /\b(because|since|therefore|so)\b/i.test(c.claim));

  if (hasCausalSignal && !hadCausalEdge) {
    const allTriples = new Map<number, FlatTriple & { stableKey: string }>();
    for (const c of claims) {
      if (c.isMeta) continue;
      if (c.triple) allTriples.set(c.index, c.triple);
    }

    if (allTriples.size >= 2) {
      const relInput = {
        sentence: selectedSentence,
        claims: claims
          .filter((c) => c.triple && !c.isMeta)
          .map((c) => ({
            index: c.index,
            text: c.claim,
            core_triple: `(${c.triple!.subject} | ${c.triple!.predicate} | ${c.triple!.object})`,
          })),
      };

      try {
        llmCalls++;
        const relOut = await withLightFallback(
          (m) => deps.runRelationLinking(m, JSON.stringify(relInput)),
          deps.getGroqModelLight(), deps.getGroqModel(), "relation-linking-xgroup",
        );

        if (Array.isArray(relOut.relations)) {
          for (const r of relOut.relations) {
            const normalizedPred = String(r.predicate).trim().toLowerCase();
            if (!ALLOWED_RELATION_PREDICATES.has(normalizedPred)) continue;
            const from = allTriples.get(r.from);
            const to = allTriples.get(r.to);
            if (!from || !to) continue;

            pushEdge(nested, existingNestedKeys, {
              kind: "relation",
              origin: "agent",
              predicate: normalizedPred,
              subject: termTriple(from),
              object: termTriple(to),
            });
          }
        }
      } catch {

      }
    }
  }

  return { llmCalls };
}
