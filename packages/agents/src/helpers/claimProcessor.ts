import type { NestedEdge, TermRef } from "../core.js";
import type { DerivedTriple, FlatTriple, ClaimAtomMatches, ClaimNode, ClaimTreePlan, TreeProcessResult } from "../types.js";
import type { ClaimPlan, GraphResult, RecursiveSlot } from "./claimPlanner.js";
import { flattenSlot } from "./llmAdapters.js";
import { tryExtractSubProposition, isReportingVerb } from "./parse.js";
import { tripleKeyed, termAtom, termTriple, pushEdge } from "./termRef.js";
import { checkReflexive } from "./validate.js";
import { normalizeForCompare, tokenize } from "./text.js";
import { trackFallback } from "./fallbackTracker.js";
import { nodeText } from "./claimTree.js";

export type ClaimResult = {
  index: number;
  claim: string;
  role: "MAIN" | "SUPPORTING";
  group: number;
  triple: (FlatTriple & { stableKey: string } & ClaimAtomMatches) | null;
  outermostMainKey?: string | null;
  isMeta?: boolean;
};

function nullClaimResult(
  index: number,
  claim: string,
  role: "MAIN" | "SUPPORTING",
  group: number,
): ClaimResult {
  return { index, claim, role, group, triple: null, outermostMainKey: null };
}

function keyedCoreIfValid(
  graph: GraphResult | null,
): (FlatTriple & { stableKey: string }) | null {
  if (!graph) return null;
  const keyed = tripleKeyed(graph.core);
  if (!checkReflexive(keyed).valid) return null;
  return keyed;
}

function isDuplicateSubjectObject(core: FlatTriple): boolean {
  const s = normalizeForCompare(core.subject);
  const o = normalizeForCompare(core.object);
  return !!s && !!o && s === o;
}

function pushDerived(
  derivedTriples: DerivedTriple[],
  keyed: FlatTriple & { stableKey: string },
  groupKey: string,
): void {
  if (!derivedTriples.some((d) => d.stableKey === keyed.stableKey)) {
    derivedTriples.push({ ...keyed, ownerGroupKey: groupKey });
  }
}

function tryPropositionalWrap(
  keyed: FlatTriple & { stableKey: string },
  groupKey: string,
  localNested: NestedEdge[],
  localNestedKeys: Set<string>,
  derivedTriples: DerivedTriple[],
): { edgeKey: string; anchorTriple: FlatTriple & { stableKey: string } } | null {
  if (isReportingVerb(keyed.predicate)) return null;

  const objProp = tryExtractSubProposition(keyed.object);
  const subjProp = tryExtractSubProposition(keyed.subject);
  if (!objProp && !subjProp) return null;

  let subjRef: TermRef;
  let subjKeyed: (FlatTriple & { stableKey: string }) | null = null;
  if (subjProp) {
    subjKeyed = tripleKeyed(subjProp);
    pushDerived(derivedTriples, subjKeyed, groupKey);
    subjRef = termTriple(subjKeyed);
  } else {
    subjRef = termAtom(keyed.subject);
  }

  let objRef: TermRef;
  let objKeyed: (FlatTriple & { stableKey: string }) | null = null;
  if (objProp) {
    objKeyed = tripleKeyed(objProp);
    pushDerived(derivedTriples, objKeyed, groupKey);
    objRef = termTriple(objKeyed);
  } else {
    objRef = termAtom(keyed.object);
  }

  const edgeKey = pushEdge(localNested, localNestedKeys, {
    kind: "relation",
    origin: "agent",
    predicate: keyed.predicate,
    subject: subjRef,
    object: objRef,
  });

  return { edgeKey, anchorTriple: objKeyed ?? subjKeyed! };
}

function areEquivalentTriples(a: FlatTriple, b: FlatTriple): boolean {
  return (
    normalizeForCompare(a.subject) === normalizeForCompare(b.subject) &&
    normalizeForCompare(a.predicate) === normalizeForCompare(b.predicate) &&
    normalizeForCompare(a.object) === normalizeForCompare(b.object)
  );
}

function buildConditionalObjectRef(
  condGraph: GraphResult | null,
  condText: string,
  derivedTriples: DerivedTriple[],
  groupKey: string,
  mainCore?: FlatTriple,
): ReturnType<typeof termAtom> | ReturnType<typeof termTriple> {
  if (!condGraph) return termAtom(condText);

  const condBase = tripleKeyed(condGraph.core);
  const condIsUsable =
    checkReflexive(condBase).valid &&
    !isDuplicateSubjectObject(condBase) &&
    !(mainCore ? areEquivalentTriples(condBase, mainCore) : false);
  if (!condIsUsable) return termAtom(condText);

  if (!derivedTriples.some((d) => d.stableKey === condBase.stableKey)) {
    derivedTriples.push({ ...condBase, ownerGroupKey: groupKey });
  }
  return termTriple(condBase);
}

function processMeta(
  plan: Extract<ClaimPlan, { kind: "meta" }>,
  graphMap: Map<string, GraphResult | null>,
  segmentIndex: number,
  tripleIdx: number,
  nested: NestedEdge[],
  existingNestedKeys: Set<string>,
  derivedTriples: DerivedTriple[],
): ClaimResult {
  const propGraph = graphMap.get(plan.graphKeys[0]) ?? null;
  if (!propGraph) return nullClaimResult(tripleIdx, plan.claim, plan.role, plan.group);

  const groupKey = `${segmentIndex}:${plan.group}`;
  const objectTriple = keyedCoreIfValid(propGraph);
  if (!objectTriple) return nullClaimResult(tripleIdx, plan.claim, plan.role, plan.group);

  const swapSP = !isReportingVerb(plan.meta.verb);
  const metaEdgeKey = pushEdge(nested, existingNestedKeys, {
    kind: "meta",
    origin: "agent",
    predicate: swapSP ? plan.meta.source : plan.meta.verb,
    subject: termAtom(swapSP ? plan.meta.verb : plan.meta.source),
    object: termTriple(objectTriple),
  });

  return { index: tripleIdx, claim: plan.claim, role: plan.role, group: plan.group, triple: objectTriple, outermostMainKey: metaEdgeKey, isMeta: true };
}

function processConditional(
  plan: Extract<ClaimPlan, { kind: "conditional" }>,
  graphMap: Map<string, GraphResult | null>,
  segmentIndex: number,
  tripleIdx: number,
  nested: NestedEdge[],
  existingNestedKeys: Set<string>,
  derivedTriples: DerivedTriple[],
): ClaimResult {
  const { claim, role, group, cond } = plan;
  const groupKey = `${segmentIndex}:${group}`;

  const mainGraph = graphMap.get(plan.graphKeys[0]) ?? null;
  const condGraph = graphMap.get(plan.graphKeys[1]) ?? null;

  const fullKw = cond.compoundKw || cond.kw;
  const mainObject = mainGraph?.core.object?.trim() ?? "";
  const mainHasObject =
    !!mainObject &&
    !(mainGraph ? isDuplicateSubjectObject(mainGraph.core) : false);

  if (mainHasObject && mainGraph) {
    const mainBase = keyedCoreIfValid(mainGraph);
    if (!mainBase) return nullClaimResult(tripleIdx, claim, role, group);
    if (!derivedTriples.some((d) => d.stableKey === mainBase.stableKey)) {
      derivedTriples.push({ ...mainBase, ownerGroupKey: groupKey });
    }

    const condRef = buildConditionalObjectRef(condGraph, cond.condText, derivedTriples, groupKey, mainBase);
    const outermostMainKey = pushEdge(nested, existingNestedKeys, {
      kind: "conditional",
      origin: "agent",
      predicate: fullKw,
      subject: termTriple(mainBase),
      object: condRef,
    });

    return { index: tripleIdx, claim, role, group, triple: mainBase, outermostMainKey };
  }

  trackFallback("processConditional:branchB");
  const subject = mainGraph?.core.subject || cond.mainText;
  const rawVerb = mainGraph?.core.predicate || null;

  if (!rawVerb) {
    return { index: tripleIdx, claim, role, group, triple: null, outermostMainKey: null };
  }

  const predicate = `${rawVerb} ${fullKw}`;
  const object = cond.condText;
  const core = tripleKeyed({ subject, predicate, object });

  const reflexiveB = checkReflexive(core);
  if (!reflexiveB.valid) return nullClaimResult(tripleIdx, claim, role, group);

  const condRef = buildConditionalObjectRef(condGraph, cond.condText, derivedTriples, groupKey, core);
  const outermostMainKey = pushEdge(nested, existingNestedKeys, {
    kind: "conditional",
    origin: "agent",
    predicate,
    subject: termAtom(subject),
    object: condRef,
  });

  return { index: tripleIdx, claim, role, group, triple: core, outermostMainKey };
}

function processCausal(
  plan: Extract<ClaimPlan, { kind: "causal" }>,
  graphMap: Map<string, GraphResult | null>,
  segmentIndex: number,
  tripleIdx: number,
  nested: NestedEdge[],
  existingNestedKeys: Set<string>,
  derivedTriples: DerivedTriple[],
): ClaimResult {
  const mainGraph = graphMap.get(plan.graphKeys[0]) ?? null;
  const reasonGraph = graphMap.get(plan.graphKeys[1]) ?? null;
  const { claim, role, group } = plan;
  const groupKey = `${segmentIndex}:${group}`;

  if (!mainGraph) return nullClaimResult(tripleIdx, claim, role, group);
  const mainKeyed = keyedCoreIfValid(mainGraph);

  // S+V detection: main graph was reflexive/invalid → compound predicate
  if (!mainKeyed) {
    trackFallback("processCausal:compoundPredicate");

    if (!reasonGraph) return nullClaimResult(tripleIdx, claim, role, group);
    const reasonKeyed = keyedCoreIfValid(reasonGraph);
    if (!reasonKeyed) return nullClaimResult(tripleIdx, claim, role, group);

    pushDerived(derivedTriples, reasonKeyed, groupKey);

    const edgeKey = pushEdge(nested, existingNestedKeys, {
      kind: "relation",
      origin: "agent",
      predicate: `${mainGraph.core.predicate} ${plan.causal.marker}`,
      subject: termAtom(mainGraph.core.subject),
      object: termTriple(reasonKeyed),
    });

    return { index: tripleIdx, claim, role, group, triple: reasonKeyed, outermostMainKey: edgeKey };
  }

  let outermostMainKey: string | null = null;

  if (reasonGraph) {
    const reasonKeyed = keyedCoreIfValid(reasonGraph);
    if (reasonKeyed) {
      if (!derivedTriples.some((d) => d.stableKey === reasonKeyed.stableKey))
        derivedTriples.push({ ...reasonKeyed, ownerGroupKey: groupKey });

      outermostMainKey = pushEdge(nested, existingNestedKeys, {
        kind: "relation",
        origin: "agent",
        predicate: plan.causal.marker,
        subject: termTriple(mainKeyed),
        object: termTriple(reasonKeyed),
      });
    }
  }

  return { index: tripleIdx, claim, role, group, triple: mainKeyed, outermostMainKey };
}

function processStandard(
  plan: Extract<ClaimPlan, { kind: "standard" }>,
  graphMap: Map<string, GraphResult | null>,
  segmentIndex: number,
  tripleIdx: number,
  nested: NestedEdge[],
  existingNestedKeys: Set<string>,
  derivedTriples: DerivedTriple[],
): ClaimResult {
  const graph = graphMap.get(plan.graphKeys[0]) ?? null;
  if (!graph) return nullClaimResult(tripleIdx, plan.claim, plan.role, plan.group);

  const groupKey = `${segmentIndex}:${plan.group}`;
  const core = keyedCoreIfValid(graph);
  if (!core) return nullClaimResult(tripleIdx, plan.claim, plan.role, plan.group);

  if (isReportingVerb(core.predicate)) {
    const subProp = tryExtractSubProposition(core.object);
    if (subProp) {
      trackFallback("processStandard:reportingVerbRecovery");
      const objectTriple = tripleKeyed(subProp);
      const recoveryMetaKey = pushEdge(nested, existingNestedKeys, {
        kind: "meta",
        origin: "agent",
        predicate: core.predicate,
        subject: termAtom(core.subject),
        object: termTriple(objectTriple),
      });
      return {
        index: tripleIdx, claim: plan.claim, role: plan.role, group: plan.group,
        triple: objectTriple, outermostMainKey: recoveryMetaKey, isMeta: true,
      };
    }
  }

  return { index: tripleIdx, claim: plan.claim, role: plan.role, group: plan.group, triple: core, outermostMainKey: null };
}

export function processClaimPlan(
  plan: ClaimPlan,
  graphMap: Map<string, GraphResult | null>,
  segmentIndex: number,
  tripleIdx: number,
  nested: NestedEdge[],
  existingNestedKeys: Set<string>,
  derivedTriples: DerivedTriple[],
): ClaimResult {
  let result: ClaimResult;
  switch (plan.kind) {
    case "meta":
      result = processMeta(plan, graphMap, segmentIndex, tripleIdx, nested, existingNestedKeys, derivedTriples);
      break;
    case "conditional":
      result = processConditional(plan, graphMap, segmentIndex, tripleIdx, nested, existingNestedKeys, derivedTriples);
      break;
    case "causal":
      result = processCausal(plan, graphMap, segmentIndex, tripleIdx, nested, existingNestedKeys, derivedTriples);
      break;
    case "standard":
      result = processStandard(plan, graphMap, segmentIndex, tripleIdx, nested, existingNestedKeys, derivedTriples);
      break;
  }
  if (!result.triple) {
    const failedKeys = plan.graphKeys.filter((k) => !graphMap.get(k));
    console.warn("[graph-fail]", {
      claimText: plan.claim,
      planKind: plan.kind,
      segmentIndex,
      group: plan.group,
      graphKeys: failedKeys.length > 0 ? failedKeys : plan.graphKeys,
    });
  }
  return result;
}

const LEAF_MEANING_MIN_OVERLAP = 0.4;
const LEAF_MEANING_MAX_MISSING = 1;

function stem(word: string): string {
  const lower = word.toLowerCase();
  if (lower.endsWith("ies") && lower.length > 4) return lower.slice(0, -3) + "y";
  if (lower.endsWith("ing") && lower.length > 5) return lower.slice(0, -3);
  if (lower.endsWith("ed") && lower.length > 4) return lower.slice(0, -2);
  if (lower.endsWith("ly") && lower.length > 4) return lower.slice(0, -2);
  if (lower.endsWith("es") && lower.length > 4) return lower.slice(0, -1);
  if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 3) return lower.slice(0, -1);
  return lower;
}

function stemSet(tokens: string[]): Set<string> {
  const s = new Set<string>();
  for (const t of tokens) {
    s.add(t);
    s.add(stem(t));
  }
  return s;
}

const PRONOUN_SET = new Set(["it", "its", "this", "that", "they", "them", "their", "these", "those", "he", "she", "we"]);

export function validateLeafMeaning(
  leafText: string,
  graph: GraphResult,
): boolean {
  const srcTokens = tokenize(leafText);
  if (srcTokens.length === 0) return false;

  const modifierText = (graph.modifiers ?? []).map((m) => `${m.prep} ${m.value}`).join(" ");
  const tripleTokens = tokenize(
    `${graph.core.subject} ${graph.core.predicate} ${graph.core.object} ${modifierText}`,
  );
  if (tripleTokens.length === 0) return false;

  const srcStems = stemSet(srcTokens);

  // Allow pronoun resolution: when the source has pronouns (e.g. "it"),
  // exempt resolved subject tokens from missing count (capped at pronoun count)
  const pronounCount = srcTokens.filter((t) => PRONOUN_SET.has(t)).length;
  const subjectTokens = pronounCount > 0 ? new Set(tokenize(graph.core.subject).map((t) => t.toLowerCase())) : null;
  let pronounExemptions = 0;

  const missing = tripleTokens.filter((t) => {
    if (srcStems.has(t) || srcStems.has(stem(t))) return false;
    if (subjectTokens && pronounExemptions < pronounCount && subjectTokens.has(t.toLowerCase())) {
      pronounExemptions++;
      return false;
    }
    return true;
  });
  if (missing.length > LEAF_MEANING_MAX_MISSING) return false;
  if (
    srcTokens.length <= 3 &&
    missing.some((t) => !/^(?:\w+ly|will|would|should|could|can|may|might|is|are|was|were|be|been|being|a|an|the)$/i.test(t))
  ) {
    return false;
  }

  const tripleStems = stemSet(tripleTokens);
  const overlap = srcTokens.filter((t) => tripleStems.has(t) || tripleStems.has(stem(t))).length;
  if (overlap / srcTokens.length < LEAF_MEANING_MIN_OVERLAP) return false;

  return true;
}

type ExtraClaim = { claim: string; triple: FlatTriple & { stableKey: string } };

function buildTermRefFromSlot(
  slot: RecursiveSlot,
  groupKey: string,
  localNested: NestedEdge[],
  localNestedKeys: Set<string>,
  extraClaims: ExtraClaim[],
): TermRef {
  if (typeof slot === "string") return termAtom(slot);

  const subjRef = buildTermRefFromSlot(slot.subject, groupKey, localNested, localNestedKeys, extraClaims);
  const objRef = buildTermRefFromSlot(slot.object, groupKey, localNested, localNestedKeys, extraClaims);

  const flatSubj = flattenSlot(slot.subject);
  const flatObj = flattenSlot(slot.object);
  const subKeyed = tripleKeyed({ subject: flatSubj, predicate: slot.predicate, object: flatObj });

  if (!checkReflexive(subKeyed).valid || isDuplicateSubjectObject(subKeyed)) {
    return termAtom(`${flatSubj} ${slot.predicate} ${flatObj}`);
  }

  // Leaf sub-triple: both children are atoms (supporting))
  if (subjRef.type === "atom" && objRef.type === "atom") {
    extraClaims.push({ claim: `${flatSubj} ${slot.predicate} ${flatObj}`, triple: subKeyed });
    return termTriple(subKeyed);
  }

  // Non-leaf: at least one child is a triple ref (nested edge)
  const edgeKey = pushEdge(localNested, localNestedKeys, {
    kind: "modifier",
    origin: "agent",
    predicate: slot.predicate,
    subject: subjRef,
    object: objRef,
  });
  return { type: "triple", tripleKey: edgeKey };
}

function processNodeRec(
  node: ClaimNode,
  graphMap: Map<string, GraphResult | null>,
  leafIndex: { current: number },
  leaves: Array<{ leafId: string; text: string }>,
  groupKey: string,
  localNested: NestedEdge[],
  localNestedKeys: Set<string>,
  derivedTriples: DerivedTriple[],
): TreeProcessResult {
  switch (node.kind) {
    case "clause": {
      return {
        ref: termAtom(node.text),
        stableKey: null,
        anchorTriple: null,
        graphable: false,
      };
    }

    case "proposition": {
      const leaf = leaves[leafIndex.current++];
      if (!leaf) {
        return { ref: termAtom(node.text), stableKey: null, anchorTriple: null, graphable: false };
      }

      const graph = graphMap.get(leaf.leafId) ?? null;
      if (!graph) {
        return { ref: termAtom(node.text), stableKey: null, anchorTriple: null, graphable: false };
      }

      const keyed = tripleKeyed(graph.core);

      if (!checkReflexive(keyed).valid || isDuplicateSubjectObject(keyed)) {
        return { ref: termAtom(node.text), stableKey: null, anchorTriple: null, graphable: false };
      }

      if (!validateLeafMeaning(node.text, graph)) {
        trackFallback("processClaimTree:leafMeaningFail");
        return { ref: termAtom(node.text), stableKey: null, anchorTriple: null, graphable: false };
      }

      // Recursive slots = ROOT NestedEdge + leaf sub-triples as extraClaims
      if (graph.recursiveSubject || graph.recursiveObject) {
        const extraClaims: ExtraClaim[] = [];

        const subjRef = graph.recursiveSubject
          ? buildTermRefFromSlot(graph.recursiveSubject, groupKey, localNested, localNestedKeys, extraClaims)
          : termAtom(graph.core.subject);
        const objRef = graph.recursiveObject
          ? buildTermRefFromSlot(graph.recursiveObject, groupKey, localNested, localNestedKeys, extraClaims)
          : termAtom(graph.core.object);

        const rootEdgeKey = pushEdge(localNested, localNestedKeys, {
          kind: "modifier",
          origin: "agent",
          predicate: graph.core.predicate,
          subject: subjRef,
          object: objRef,
        });

        return {
          ref: { type: "triple", tripleKey: rootEdgeKey },
          stableKey: rootEdgeKey,
          anchorTriple: keyed,
          graphable: true,
          extraClaims,
        };
      }

      const propWrap = tryPropositionalWrap(
        keyed, groupKey, localNested, localNestedKeys, derivedTriples,
      );
      if (propWrap) {
        trackFallback("processClaimTree:propositionalWrap");
        return {
          ref: { type: "triple", tripleKey: propWrap.edgeKey },
          stableKey: propWrap.edgeKey,
          anchorTriple: propWrap.anchorTriple,
          graphable: true,
        };
      }

      return {
        ref: termTriple(keyed),
        stableKey: keyed.stableKey,
        anchorTriple: keyed,
        graphable: true,
      };
    }

    case "meta": {
      const childResult = processNodeRec(
        node.child, graphMap, leafIndex, leaves, groupKey,
        localNested, localNestedKeys, derivedTriples,
      );

      const swapSP = !isReportingVerb(node.verb);
      const edgeKey = pushEdge(localNested, localNestedKeys, {
        kind: "meta",
        origin: "agent",
        predicate: swapSP ? node.source : node.verb,
        subject: termAtom(swapSP ? node.verb : node.source),
        object: childResult.ref,
      });

      return {
        ref: { type: "triple", tripleKey: edgeKey },
        stableKey: edgeKey,
        anchorTriple: childResult.anchorTriple,
        graphable: childResult.graphable,
        extraClaims: childResult.extraClaims,
      };
    }

    case "conditional": {
      const mainResult = processNodeRec(
        node.main, graphMap, leafIndex, leaves, groupKey,
        localNested, localNestedKeys, derivedTriples,
      );
      const condResult = processNodeRec(
        node.condition, graphMap, leafIndex, leaves, groupKey,
        localNested, localNestedKeys, derivedTriples,
      );

      const condHasRecursive = (condResult.extraClaims?.length ?? 0) > 0;
      if (condResult.anchorTriple && !condHasRecursive) {
        if (!derivedTriples.some((d) => d.stableKey === condResult.anchorTriple!.stableKey)) {
          derivedTriples.push({ ...condResult.anchorTriple, ownerGroupKey: groupKey });
        }
      }

      const fullKw = node.compoundKw ?? node.kw;
      const edgeKey = pushEdge(localNested, localNestedKeys, {
        kind: "conditional",
        origin: "agent",
        predicate: fullKw,
        subject: mainResult.ref,
        object: condResult.ref,
      });

      const mergedExtra = [
        ...(mainResult.extraClaims ?? []),
        ...(condResult.extraClaims ?? []),
      ];

      return {
        ref: { type: "triple", tripleKey: edgeKey },
        stableKey: edgeKey,
        anchorTriple: mainResult.anchorTriple,
        graphable: mainResult.graphable || condResult.graphable,
        extraClaims: mergedExtra.length > 0 ? mergedExtra : undefined,
      };
    }

    case "causal": {
      // Peek main graph BEFORE recursion (read-only) for S+V detection
      const mainPeekGraph = (node.main.kind === "proposition" && leaves[leafIndex.current])
        ? (graphMap.get(leaves[leafIndex.current].leafId) ?? null)
        : null;

      const mainResult = processNodeRec(
        node.main, graphMap, leafIndex, leaves, groupKey,
        localNested, localNestedKeys, derivedTriples,
      );
      const reasonResult = processNodeRec(
        node.reason, graphMap, leafIndex, leaves, groupKey,
        localNested, localNestedKeys, derivedTriples,
      );

      // S+V detection: main failed to produce a valid triple (reflexive/invalid)
      if (!mainResult.anchorTriple && mainPeekGraph) {
        const edgeKey = pushEdge(localNested, localNestedKeys, {
          kind: "relation",
          origin: "agent",
          predicate: `${mainPeekGraph.core.predicate} ${node.marker}`,
          subject: termAtom(mainPeekGraph.core.subject),
          object: reasonResult.ref,
        });

        const reasonHasRecursive = (reasonResult.extraClaims?.length ?? 0) > 0;
        if (reasonResult.anchorTriple && !reasonHasRecursive) {
          pushDerived(derivedTriples, reasonResult.anchorTriple, groupKey);
        }

        // Synthetic anchor fallback if reason also failed
        const syntheticAnchor = reasonResult.anchorTriple ?? tripleKeyed({
          subject: mainPeekGraph.core.subject,
          predicate: `${mainPeekGraph.core.predicate} ${node.marker}`,
          object: nodeText(node.reason),
        });

        return {
          ref: { type: "triple", tripleKey: edgeKey },
          stableKey: edgeKey,
          anchorTriple: syntheticAnchor,
          graphable: reasonResult.graphable,
          extraClaims: reasonResult.extraClaims,
        };
      }

      if (!mainResult.anchorTriple && !mainPeekGraph) {
        return { ref: termAtom(nodeText(node.main)), stableKey: null, anchorTriple: null, graphable: false };
      }

      const reasonHasRecursive = (reasonResult.extraClaims?.length ?? 0) > 0;
      if (reasonResult.anchorTriple && !reasonHasRecursive) {
        if (!derivedTriples.some((d) => d.stableKey === reasonResult.anchorTriple!.stableKey)) {
          derivedTriples.push({ ...reasonResult.anchorTriple, ownerGroupKey: groupKey });
        }
      }

      const edgeKey = pushEdge(localNested, localNestedKeys, {
        kind: "relation",
        origin: "agent",
        predicate: node.marker,
        subject: mainResult.ref,
        object: reasonResult.ref,
      });

      const mergedExtra = [
        ...(mainResult.extraClaims ?? []),
        ...(reasonResult.extraClaims ?? []),
      ];

      return {
        ref: { type: "triple", tripleKey: edgeKey },
        stableKey: edgeKey,
        anchorTriple: mainResult.anchorTriple,
        graphable: mainResult.graphable || reasonResult.graphable,
        extraClaims: mergedExtra.length > 0 ? mergedExtra : undefined,
      };
    }
  }
}

export function processClaimTree(
  plan: ClaimTreePlan,
  graphMap: Map<string, GraphResult | null>,
  segmentIndex: number,
  tripleIdx: number,
  nested: NestedEdge[],
  existingNestedKeys: Set<string>,
  derivedTriples: DerivedTriple[],
): ClaimResult[] {
  const groupKey = `${segmentIndex}:${plan.group}`;

  const localNested: NestedEdge[] = [];
  const localNestedKeys = new Set<string>();
  const localDerived: DerivedTriple[] = [];

  const leafIndex = { current: 0 };
  const result = processNodeRec(
    plan.tree,
    graphMap,
    leafIndex,
    plan.leaves,
    groupKey,
    localNested,
    localNestedKeys,
    localDerived,
  );

  if (result.anchorTriple) {
    for (const edge of localNested) {
      if (!existingNestedKeys.has(edge.stableKey)) {
        existingNestedKeys.add(edge.stableKey);
        nested.push(edge);
      }
    }
    for (const dt of localDerived) {
      if (!derivedTriples.some((d) => d.stableKey === dt.stableKey)) {
        derivedTriples.push(dt);
      }
    }

    const outermostMainKey = result.stableKey !== result.anchorTriple.stableKey ? result.stableKey : null;

    const results: ClaimResult[] = [{
      index: tripleIdx,
      claim: plan.claim,
      role: plan.role,
      group: plan.group,
      triple: result.anchorTriple,
      outermostMainKey,
    }];

    // Add leaf sub-triples as SUPPORTING claims (skip anchor — already in results[0])
    if (result.extraClaims?.length) {
      for (const ec of result.extraClaims) {
        if (ec.triple.stableKey === result.anchorTriple!.stableKey) continue;
        results.push({
          index: tripleIdx + results.length,
          claim: ec.claim,
          role: "SUPPORTING",
          group: plan.group,
          triple: ec.triple,
          outermostMainKey,
        });
      }
    }

    return results;
  }

  // All leaves failed → null result, edges are NOT committed (orphan purge)
  return [{
    index: tripleIdx,
    claim: plan.claim,
    role: plan.role,
    group: plan.group,
    triple: null,
    outermostMainKey: null,
  }];
}
