import { splitMarkdownIntoSentences } from "./claimify/split.js";
import { runClaimDecomposer } from "./agents/claim-decomposer.js";
import { runGraphExtraction } from "./agents/graph-extractor.js";
import { runRelationLinking } from "./agents/relation-agent.js";
import { runStanceVerification } from "./agents/stance-verification-agent.js";
import { runAtomMatcher } from "./agents/atom-matcher.js";
import { getGroqModel, getGroqModelLight } from "./providers/groq.js";

import type { DerivedTriple, ExtractionResult, RejectionCode, ExtractionOptions } from "./types.js";

import { retryWithBackoff, isLlmUnavailable } from "./utils/concurrency.js";
import { runPreFilter } from "./agents/pre-filter.js";

import { safeTrim, stripOuterQuotes, ensurePeriod } from "./helpers/text.js";
import { buildClaimPlans, type GraphResult } from "./helpers/claimPlanner.js";
import { processClaimPlan } from "./helpers/claimProcessor.js";
import { canonicalizePreGraph, deduplicateGraphPlans, enforceRoles } from "./helpers/canonicalization.js";
import { parseMetaClaim } from "./helpers/parse.js";

import { selectAndDecompose, type DecomposeDeps, graphFromClaim, type GraphDeps } from "./helpers/llmAdapters.js";
import { runRelationStage, type RelationDeps } from "./stages/relationStage.js";
import { runAtomMatchStage, type AtomMatchDeps } from "./stages/atomMatchStage.js";
import { runStanceStage, type StanceDeps } from "./stages/stanceStage.js";
import { normalize, tokenSimilarity } from "./utils/similarity.js";
import { NEGATION_RE } from "./helpers/rules/extractionRules.js";
import { resetFallbackTracking, getFallbackSummary } from "./helpers/fallbackTracker.js";

const decomposeDeps: DecomposeDeps = { runClaimDecomposer, getGroqModel };
const graphDeps: GraphDeps = { runGraphExtraction, getGroqModel };
const relationDeps: RelationDeps = { runRelationLinking, getGroqModel, getGroqModelLight };
const atomMatchDeps: AtomMatchDeps = { runAtomMatcher, getGroqModel, getGroqModelLight };
const stanceDeps: StanceDeps = { runStanceVerification, getGroqModel };

type ParentFilterReason = "drop_unrelated" | "drop_duplicate_parent";

function hasLogicalNegation(text: string): boolean {
  // "not only/just" is usually emphatic, not a semantic negation.
  const scrubbed = text.replace(/\bnot\s+(only|just)\b/gi, "");
  return NEGATION_RE.test(scrubbed);
}

function isDuplicateOfParentClaim(claimText: string, parentText: string): boolean {
  const claimNorm = normalize(claimText);
  const parentNorm = normalize(parentText);
  if (!claimNorm || !parentNorm) return false;

  const directSim = tokenSimilarity(claimNorm, parentNorm);
  if (directSim >= 0.72) {
    const sameNegationPolarity = hasLogicalNegation(claimText) === hasLogicalNegation(parentText);
    if (sameNegationPolarity) return true;
  }

  // Meta-wrapper duplicate: "Some people think X" vs parent "X"
  const meta = parseMetaClaim(claimText);
  if (!meta) return false;
  const propositionNorm = normalize(meta.proposition);
  if (!propositionNorm) return false;
  const propSim = tokenSimilarity(propositionNorm, parentNorm);
  if (propSim < 0.72) return false;

  const sameNegationPolarity = hasLogicalNegation(meta.proposition) === hasLogicalNegation(parentText);
  return sameNegationPolarity;
}

function filterClaimsAgainstParent(
  perSegment: ExtractionResult["perSegment"],
  parentContext: string,
): { droppedUnrelated: number; droppedDuplicate: number } {
  let droppedUnrelated = 0;
  let droppedDuplicate = 0;

  for (const seg of perSegment) {
    const nextClaims = [];
    for (const c of seg.claims) {
      let reason: ParentFilterReason | null = null;
      if (c.isRelevant === false) {
        reason = "drop_unrelated";
      } else if (isDuplicateOfParentClaim(c.claim, parentContext)) {
        reason = "drop_duplicate_parent";
      }

      if (reason === "drop_unrelated") {
        droppedUnrelated++;
        continue;
      }
      if (reason === "drop_duplicate_parent") {
        droppedDuplicate++;
        continue;
      }
      nextClaims.push(c);
    }
    seg.claims = nextClaims;
  }

  return { droppedUnrelated, droppedDuplicate };
}

function purgeOrphanContext(
  perSegment: ExtractionResult["perSegment"],
  nested: ExtractionResult["nested"],
  derivedTriples: DerivedTriple[],
): void {
  const keptGroupKeys = new Set<string>();
  const keptCoreTripleKeys = new Set<string>();
  const requiredNestedKeys = new Set<string>();

  for (let i = 0; i < perSegment.length; i++) {
    for (const c of perSegment[i].claims) {
      keptGroupKeys.add(`${i}:${c.group}`);
      if (c.triple?.stableKey) keptCoreTripleKeys.add(c.triple.stableKey);
      if (c.outermostMainKey) requiredNestedKeys.add(c.outermostMainKey);
    }
  }

  const keptDerived = derivedTriples.filter((dt) => keptGroupKeys.has(dt.ownerGroupKey));
  derivedTriples.splice(0, derivedTriples.length, ...keptDerived);

  const knownTripleKeys = new Set<string>([
    ...keptCoreTripleKeys,
    ...keptDerived.map((d) => d.stableKey),
  ]);

  const keptEdgeKeys = new Set<string>();
  const keptEdges: ExtractionResult["nested"] = [];

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of nested) {
      if (keptEdgeKeys.has(edge.stableKey)) continue;

      const tripleRefs: string[] = [];
      if (edge.subject.type === "triple") tripleRefs.push(edge.subject.tripleKey);
      if (edge.object.type === "triple") tripleRefs.push(edge.object.tripleKey);

      const allRefsKnown = tripleRefs.every((k) => knownTripleKeys.has(k));
      if (!allRefsKnown) continue;

      const touchesKnown = tripleRefs.some((k) => knownTripleKeys.has(k));
      const isRequired = requiredNestedKeys.has(edge.stableKey);
      if (!isRequired && !touchesKnown) continue;

      keptEdgeKeys.add(edge.stableKey);
      keptEdges.push(edge);
      knownTripleKeys.add(edge.stableKey);
      changed = true;
    }
  }

  nested.splice(0, nested.length, ...keptEdges);

  for (const seg of perSegment) {
    for (const c of seg.claims) {
      if (c.outermostMainKey && !keptEdgeKeys.has(c.outermostMainKey)) {
        c.outermostMainKey = null;
      }
    }
  }
}

export async function runExtraction(inputText: string, options: ExtractionOptions = {}): Promise<ExtractionResult> {
  resetFallbackTracking();
  const segments = splitMarkdownIntoSentences(inputText);
  let llmCallCount = 0;
  const perSegment: ExtractionResult["perSegment"] = [];
  const nested: ExtractionResult["nested"] = [];
  const derivedTriples: DerivedTriple[] = [];
  const themeContext = safeTrim(options.themeTitle);
  const parentContext = safeTrim(options.parentClaimText);
  const dropReasons: string[] = [];

  const needsPreFilter = !!parentContext || inputText.trim().length < 30 || inputText.trim().length > 3000;
  if (needsPreFilter) {
    try {
      llmCallCount++;
      const filter = await retryWithBackoff(() =>
        runPreFilter(getGroqModelLight(), inputText, parentContext),
      );
      if (!filter.proceed) {
        const code = filter.code as RejectionCode;
        return { perSegment: [], nested: [], derivedTriples: [], llmCallCount, rejection: { code } };
      }
    } catch {}
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const headerPath = (seg.headerPath ?? []).join(" > ");
    let header_context = themeContext
      ? (headerPath ? `${themeContext} > ${headerPath}` : themeContext)
      : headerPath;

    if (parentContext) {
      header_context = header_context
        ? `${header_context} | In reply to: "${parentContext}"`
        : `In reply to: "${parentContext}"`;
    }

    const prev = i > 0 ? segments[i - 1].sentence : "";
    const raw = stripOuterQuotes(seg.sentence);

    let decomposed: Awaited<ReturnType<typeof selectAndDecompose>>;
    try {
      llmCallCount++;
      decomposed = await selectAndDecompose(header_context, prev, raw, decomposeDeps);
    } catch (err) {
      return {
        perSegment, nested, derivedTriples, llmCallCount,
        rejection: { code: "LLM_UNAVAILABLE", detail: err instanceof Error ? err.message : String(err) },
      };
    }

    if (!decomposed.keep) {
      dropReasons.push(decomposed.reason);
      perSegment.push({ headerPath: seg.headerPath ?? [], sentence: seg.sentence, selectedSentence: null, claims: [] });
      continue;
    }

    const selectedSentence = raw;
    const sentenceContext = [parentContext, prev, selectedSentence].filter(Boolean).join(" ");

    const canonicalized = canonicalizePreGraph(
      decomposed.claims.map((c) => ({ ...c, text: ensurePeriod(c.text) })),
      { parentClaimText: parentContext, sourceSentence: selectedSentence },
    );

    const item: ExtractionResult["perSegment"][number] = {
      headerPath: seg.headerPath ?? [],
      sentence: seg.sentence,
      selectedSentence: selectedSentence || null,
      claims: [],
    };

    const existingNestedKeys = new Set<string>(nested.map((n) => n.stableKey));

    const { plans, graphJobs } = buildClaimPlans(canonicalized, sentenceContext, (claim, ctx) => graphFromClaim(claim, ctx, graphDeps));

    llmCallCount += graphJobs.size;
    const graphKeys = [...graphJobs.keys()];
    const graphResults = await Promise.allSettled(graphKeys.map((k) => graphJobs.get(k)!));

    for (const r of graphResults) {
      if (r.status === "rejected" && isLlmUnavailable(r.reason)) {
        return {
          perSegment, nested, derivedTriples, llmCallCount,
          rejection: { code: "LLM_UNAVAILABLE" as RejectionCode, detail: r.reason instanceof Error ? r.reason.message : String(r.reason) },
        };
      }
    }

    const graphMap = new Map<string, GraphResult | null>();
    for (let gi = 0; gi < graphKeys.length; gi++) {
      const r = graphResults[gi];
      graphMap.set(graphKeys[gi], r.status === "fulfilled" ? r.value : null);
    }

    const dedupedPlans = deduplicateGraphPlans(plans, graphMap);

    let tripleIdx = 0;
    for (const plan of dedupedPlans) {
      item.claims.push(processClaimPlan(plan, graphMap, i, tripleIdx, nested, existingNestedKeys, derivedTriples));
      tripleIdx++;
    }

    enforceRoles(item.claims, selectedSentence);

    const relResult = await runRelationStage(item.claims, selectedSentence, nested, existingNestedKeys, relationDeps);
    llmCallCount += relResult.llmCalls;

    perSegment.push(item);
  }

  if (options.searchFn) {
    const atomResult = await runAtomMatchStage(perSegment, options.searchFn, atomMatchDeps);
    llmCallCount += atomResult.llmCalls;
  }

  let parentFilterStats = { droppedUnrelated: 0, droppedDuplicate: 0 };
  {
    const stanceResult = await runStanceStage(perSegment, parentContext ?? "", options.userStance, stanceDeps);
    llmCallCount += stanceResult.llmCalls;

    if (parentContext) {
      parentFilterStats = filterClaimsAgainstParent(perSegment, parentContext);
      purgeOrphanContext(perSegment, nested, derivedTriples);
      for (const item of perSegment) {
        if (item.claims.length === 0) continue;
        enforceRoles(item.claims, item.selectedSentence ?? item.sentence);
      }
    }
  }

  const totalClaims = perSegment.reduce((sum, seg) => sum + seg.claims.length, 0);
  const totalMain = perSegment.reduce((s, seg) => s + seg.claims.filter((c) => c.role === "MAIN").length, 0);

  if (totalClaims === 0 && dropReasons.length > 0) {
    const detail = dropReasons[0];
    const code: RejectionCode = detail.toLowerCase().startsWith("off-topic") ? "OFF_TOPIC" : "NOT_DEBATABLE";
    return { perSegment, nested, derivedTriples, llmCallCount, rejection: { code, detail } };
  }

  if (
    totalClaims === 0 &&
    (parentFilterStats.droppedDuplicate > 0 || parentFilterStats.droppedUnrelated > 0)
  ) {
    return {
      perSegment,
      nested,
      derivedTriples,
      llmCallCount,
      rejection: {
        code: "NO_NEW_INFORMATION",
        detail: `Filtered by parent-check (duplicate: ${parentFilterStats.droppedDuplicate}, unrelated: ${parentFilterStats.droppedUnrelated}).`,
      },
    };
  }

  if (totalClaims === 0) {
    return { perSegment, nested, derivedTriples, llmCallCount, rejection: { code: "NO_MAIN_CLAIMS" } };
  }

  if (totalMain === 0 && totalClaims > 0) {
    return { perSegment, nested, derivedTriples, llmCallCount, rejection: { code: "NO_MAIN_CLAIMS" } };
  }

  return { perSegment, nested, derivedTriples, llmCallCount };
}
