import { atomKeyFromLabel } from "@db/agents";
import type { NestedEdgeContext } from "@/lib/validation/semanticRelevance";
import type { ApiProposal, ProposalDraft, NestedProposalDraft, DerivedTripleDraft, NestedTermRef, NestedEdgeLike } from "./types";
import { safeDisplayLabel, resolveTermRefLabel } from "./display";

export function buildNestedRefLabels(apiProposals: ApiProposal[]): Map<string, string> {
  const labelMap = new Map<string, string>();

  for (const p of apiProposals) {
    if (p.kind === "NESTED_TRIPLE") continue;
    const sk = p.payload?.stableKey as string | undefined;
    if (!sk) continue;
    const s = safeDisplayLabel(p.payload?.subjectMatchedLabel as string | undefined, "") || p.payload?.subject;
    const pred = safeDisplayLabel(p.payload?.predicateMatchedLabel as string | undefined, "") || p.payload?.predicate;
    const o = safeDisplayLabel(p.payload?.objectMatchedLabel as string | undefined, "") || p.payload?.object;
    const label = [s, pred, o].filter(Boolean).join(" \u00B7 ");
    labelMap.set(sk, label);
  }

  for (const p of apiProposals) {
    if (p.kind !== "NESTED_TRIPLE") continue;
    for (const refKey of ["subject", "object"] as const) {
      const ref = p.payload?.[refKey] as NestedTermRef | undefined;
      if (ref?.type === "triple" && ref.label && !labelMap.has(ref.tripleKey)) {
        labelMap.set(ref.tripleKey, ref.label);
      }
    }
  }

  const nestedEdges = apiProposals.filter((p) => p.kind === "NESTED_TRIPLE");
  let remaining = nestedEdges.filter((p) => {
    const sk = p.payload?.stableKey as string | undefined;
    return sk && !labelMap.has(sk);
  });
  const MAX_ROUNDS = 10;
  for (let round = 0; round < MAX_ROUNDS && remaining.length > 0; round++) {
    const deferred: typeof remaining = [];
    for (const p of remaining) {
      const sk = p.payload?.stableKey as string;
      const pred = ((p.payload?.predicate as string) ?? "").trim();
      if (!pred) continue;
      const subLabel = resolveTermRefLabel(p.payload?.subject as NestedTermRef | undefined, labelMap);
      const objLabel = resolveTermRefLabel(p.payload?.object as NestedTermRef | undefined, labelMap);
      if (subLabel && objLabel) {
        labelMap.set(sk, `${subLabel} · ${pred} · ${objLabel}`);
      } else {
        deferred.push(p);
      }
    }
    if (deferred.length === remaining.length) break;
    remaining = deferred;
  }

  return labelMap;
}

export function buildNestedRefLabelsFromState(
  proposals: ProposalDraft[],
  nestedProposals: NestedProposalDraft[],
  derivedTriples: DerivedTripleDraft[],
): Map<string, string> {
  const labelMap = new Map<string, string>();

  for (const p of proposals) {
    if (!p.stableKey) continue;
    const s = safeDisplayLabel(p.subjectMatchedLabel, "") || p.sText;
    const pred = safeDisplayLabel(p.predicateMatchedLabel, "") || p.pText;
    const o = safeDisplayLabel(p.objectMatchedLabel, "") || p.oText;
    labelMap.set(p.stableKey, [s, pred, o].filter(Boolean).join(" \u00B7 "));
  }

  for (const dt of derivedTriples) {
    if (!dt.stableKey || labelMap.has(dt.stableKey)) continue;
    labelMap.set(dt.stableKey, [dt.subject, dt.predicate, dt.object].filter(Boolean).join(" \u00B7 "));
  }

  for (const p of proposals) {
    for (const [local, matched] of [
      [p.sText, p.subjectMatchedLabel],
      [p.pText, p.predicateMatchedLabel],
      [p.oText, p.objectMatchedLabel],
    ] as const) {
      if (matched && local) {
        const key = `atom:${atomKeyFromLabel(local)}`;
        if (!labelMap.has(key)) labelMap.set(key, matched);
      }
    }
  }

  for (const n of nestedProposals) {
    for (const ref of [n.subject, n.object]) {
      if (ref.type === "triple" && ref.label && !labelMap.has(ref.tripleKey)) {
        labelMap.set(ref.tripleKey, ref.label);
      }
    }
  }

  let remaining = nestedProposals.filter((n) => n.stableKey && !labelMap.has(n.stableKey));
  for (let round = 0; round < 10 && remaining.length > 0; round++) {
    const deferred: typeof remaining = [];
    for (const n of remaining) {
      const pred = n.predicate?.trim();
      if (!pred) continue;
      const subLabel = resolveTermRefLabel(n.subject, labelMap);
      const objLabel = resolveTermRefLabel(n.object, labelMap);
      if (subLabel && objLabel) {
        labelMap.set(n.stableKey, `${subLabel} · ${pred} · ${objLabel}`);
      } else {
        deferred.push(n);
      }
    }
    if (deferred.length === remaining.length) break;
    remaining = deferred;
  }

  return labelMap;
}

export function resolveNestedLabels(
  nestedEdges: NestedEdgeLike[],
  labelMap: Map<string, string>,
): Map<string, string> {
  for (const e of nestedEdges) {
    for (const ref of [e.subject, e.object]) {
      if (ref.type === "triple" && ref.label && ref.tripleKey && !labelMap.has(ref.tripleKey)) {
        labelMap.set(ref.tripleKey, ref.label);
      }
    }
  }

  let remaining = nestedEdges.filter((e) => e.stableKey && !labelMap.has(e.stableKey));
  const MAX_ROUNDS = 10;
  for (let round = 0; round < MAX_ROUNDS && remaining.length > 0; round++) {
    const deferred: NestedEdgeLike[] = [];
    for (const e of remaining) {
      const subLabel = e.subject.label
        ?? (e.subject.tripleKey ? labelMap.get(e.subject.tripleKey) : undefined);
      const objLabel = e.object.label
        ?? (e.object.tripleKey ? labelMap.get(e.object.tripleKey) : undefined);
      if (subLabel && objLabel) {
        labelMap.set(e.stableKey, `${subLabel} · ${e.predicate} · ${objLabel}`.trim());
      } else {
        deferred.push(e);
      }
    }
    if (deferred.length === remaining.length) break;
    remaining = deferred;
  }
  for (const e of remaining) {
    if (labelMap.has(e.stableKey)) continue;
    const subLabel = e.subject.label
      ?? (e.subject.tripleKey ? labelMap.get(e.subject.tripleKey) : undefined) ?? "";
    const objLabel = e.object.label
      ?? (e.object.tripleKey ? labelMap.get(e.object.tripleKey) : undefined) ?? "";
    labelMap.set(e.stableKey, `${subLabel} · ${e.predicate} · ${objLabel}`.trim());
  }
  return labelMap;
}

function mapEdgeKind(edgeKind: string): NestedEdgeContext["kind"] {
  if (edgeKind === "conditional" || edgeKind === "meta" || edgeKind === "relation" || edgeKind === "modifier") return edgeKind;
  return "modifier";
}

export function buildNestedEdgeContexts(
  proposalStableKey: string,
  nestedEdges: NestedEdgeLike[],
  nestedRefLabels: Map<string, string>,
): NestedEdgeContext[] {
  const result: NestedEdgeContext[] = [];
  const visited = new Set<string>();
  const queue = [proposalStableKey];

  while (queue.length > 0) {
    const currentKey = queue.shift()!;
    for (const edge of nestedEdges) {
      if (visited.has(edge.stableKey)) continue;
      const isSubRef = edge.subject.type === "triple" && edge.subject.tripleKey === currentKey;
      const isObjRef = edge.object.type === "triple" && edge.object.tripleKey === currentKey;
      if (!isSubRef && !isObjRef) continue;

      visited.add(edge.stableKey);
      const text = nestedRefLabels.get(edge.stableKey)
        ?? `${edge.subject.label ?? ""} ${edge.predicate} ${edge.object.label ?? ""}`.trim();
      result.push({ kind: mapEdgeKind(edge.edgeKind), text });

      queue.push(edge.stableKey);
    }
  }
  return result;
}
