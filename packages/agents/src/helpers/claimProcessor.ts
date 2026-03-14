import type { NestedEdge, TermRef } from "../core.js";
import type { DerivedTriple, FlatTriple, ClaimAtomMatches } from "../types.js";
import type { ClaimPlan, GraphResult } from "./claimPlanner.js";
import { tryDecomposeSubject, tryExtractSubProposition, isReportingVerb } from "./parse.js";
import { tripleKeyed, termAtom, termTriple, pushEdge, pushModifierEdges } from "./termRef.js";
import { checkReflexive } from "./validate.js";
import { normalizeForCompare } from "./text.js";
import { trackFallback } from "./fallbackTracker.js";

export type ClaimResult = {
  index: number;
  claim: string;
  role: "MAIN" | "SUPPORTING";
  group: number;
  triple: (FlatTriple & { stableKey: string } & ClaimAtomMatches) | null;
  outermostMainKey?: string | null;
  isMeta?: boolean;
};

export function sortModifiersByPosition(
  modifiers: Array<{ prep: string; value: string }>,
  claimText: string,
): Array<{ prep: string; value: string }> {
  if (modifiers.length <= 1) return modifiers;
  const lower = claimText.toLowerCase();
  return modifiers
    .map((mod, origIdx) => ({ mod, origIdx }))
    .sort((a, b) => {
      const phraseA = `${a.mod.prep} ${a.mod.value}`.toLowerCase();
      const phraseB = `${b.mod.prep} ${b.mod.value}`.toLowerCase();
      const posA = lower.indexOf(phraseA);
      const posB = lower.indexOf(phraseB);
      const fallA = posA !== -1 ? posA : lower.indexOf(a.mod.prep.toLowerCase());
      const fallB = posB !== -1 ? posB : lower.indexOf(b.mod.prep.toLowerCase());
      const effA = fallA === -1 ? Infinity : fallA;
      const effB = fallB === -1 ? Infinity : fallB;
      return effA !== effB ? effA - effB : a.origIdx - b.origIdx;
    })
    .map(({ mod }) => mod);
}

function pushSubjectDecomp(
  graph: { core: FlatTriple },
  parentKeyed: FlatTriple & { stableKey: string },
  nested: NestedEdge[],
  existingNestedKeys: Set<string>,
  derivedTriples: DerivedTriple[],
  groupKey: string,
) {
  const subjDecomp = tryDecomposeSubject(graph.core);
  if (!subjDecomp) return;
  const subTriple = tripleKeyed(subjDecomp.subTriple);
  if (!derivedTriples.some((d) => d.stableKey === subTriple.stableKey)) {
    derivedTriples.push({ ...subTriple, ownerGroupKey: groupKey });
  }
  pushEdge(nested, existingNestedKeys, {
    kind: "modifier",
    origin: "agent",
    predicate: subjDecomp.prep,
    subject: termTriple(parentKeyed),
    object: termTriple(subTriple),
  });
}

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

function applyGraphPostProcessing(
  graph: GraphResult,
  parentKeyed: FlatTriple & { stableKey: string },
  claimText: string,
  groupKey: string,
  nested: NestedEdge[],
  existingNestedKeys: Set<string>,
  derivedTriples: DerivedTriple[],
  opts?: { includeSubjectDecomp?: boolean; sortModifiers?: boolean },
): string | null {
  let outermost: string | null = null;
  if (graph.modifiers?.length) {
    const sortedMods =
      opts?.sortModifiers === false
        ? graph.modifiers
        : sortModifiersByPosition(graph.modifiers, claimText);
    outermost = pushModifierEdges(
      nested,
      existingNestedKeys,
      parentKeyed,
      sortedMods,
      derivedTriples,
      groupKey,
    );
  }
  if (opts?.includeSubjectDecomp !== false) {
    pushSubjectDecomp(graph, parentKeyed, nested, existingNestedKeys, derivedTriples, groupKey);
  }
  return outermost;
}

function isDuplicateSubjectObject(core: FlatTriple): boolean {
  const s = normalizeForCompare(core.subject);
  const o = normalizeForCompare(core.object);
  return !!s && !!o && s === o;
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

  const metaEdgeKey = pushEdge(nested, existingNestedKeys, {
    kind: "meta",
    origin: "agent",
    predicate: plan.meta.verb,
    subject: termAtom(plan.meta.source),
    object: termTriple(objectTriple),
  });

  applyGraphPostProcessing(
    propGraph,
    objectTriple,
    plan.claim,
    groupKey,
    nested,
    existingNestedKeys,
    derivedTriples,
  );

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

    const modifierOuterKey = applyGraphPostProcessing(
      mainGraph,
      mainBase,
      claim,
      groupKey,
      nested,
      existingNestedKeys,
      derivedTriples,
    );

    const condRef = buildConditionalObjectRef(condGraph, cond.condText, derivedTriples, groupKey, mainBase);
    const condSubjectRef: TermRef = modifierOuterKey
      ? { type: "triple", tripleKey: modifierOuterKey }
      : termTriple(mainBase);
    const outermostMainKey = pushEdge(nested, existingNestedKeys, {
      kind: "conditional",
      origin: "agent",
      predicate: fullKw,
      subject: condSubjectRef,
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

  if (mainGraph?.modifiers?.length) {
    applyGraphPostProcessing(
      mainGraph,
      core,
      claim,
      groupKey,
      nested,
      existingNestedKeys,
      derivedTriples,
      { includeSubjectDecomp: false, sortModifiers: false },
    );
  }

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
  if (!mainKeyed) return nullClaimResult(tripleIdx, claim, role, group);

  const modifierOuterKey = applyGraphPostProcessing(
    mainGraph,
    mainKeyed,
    claim,
    groupKey,
    nested,
    existingNestedKeys,
    derivedTriples,
  );

  let outermostMainKey: string | null = modifierOuterKey;

  if (reasonGraph) {
    const reasonKeyed = keyedCoreIfValid(reasonGraph);
    if (reasonKeyed) {
      if (!derivedTriples.some((d) => d.stableKey === reasonKeyed.stableKey))
        derivedTriples.push({ ...reasonKeyed, ownerGroupKey: groupKey });

      const causalSubjectRef: TermRef = modifierOuterKey
        ? { type: "triple", tripleKey: modifierOuterKey }
        : termTriple(mainKeyed);

      outermostMainKey = pushEdge(nested, existingNestedKeys, {
        kind: "relation",
        origin: "agent",
        predicate: plan.causal.marker,
        subject: causalSubjectRef,
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
      const recoveryMods = sortModifiersByPosition(graph.modifiers, plan.claim);
      pushModifierEdges(nested, existingNestedKeys, objectTriple, recoveryMods, derivedTriples, groupKey);
      pushSubjectDecomp(graph, objectTriple, nested, existingNestedKeys, derivedTriples, groupKey);
      return {
        index: tripleIdx, claim: plan.claim, role: plan.role, group: plan.group,
        triple: objectTriple, outermostMainKey: recoveryMetaKey, isMeta: true,
      };
    }
  }

  const outermostMainKey = applyGraphPostProcessing(
    graph,
    core,
    plan.claim,
    groupKey,
    nested,
    existingNestedKeys,
    derivedTriples,
    { includeSubjectDecomp: false },
  );

  pushSubjectDecomp(graph, core, nested, existingNestedKeys, derivedTriples, groupKey);

  return { index: tripleIdx, claim: plan.claim, role: plan.role, group: plan.group, triple: core, outermostMainKey: outermostMainKey };
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
