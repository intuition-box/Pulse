import type { DraftPost, ProposalDraft, NestedProposalDraft } from "./types";

export type MainRef =
  | { type: "proposal"; id: string }
  | { type: "nested"; nestedId: string; nestedStableKey: string }
  | { type: "error"; reason: string };

export function computeMainRef(
  mainProposalId: string | null,
  proposals: ProposalDraft[],
  nestedProposals: NestedProposalDraft[],
): MainRef | null {
  if (!mainProposalId) return null;
  const mainP = proposals.find((p) => p.id === mainProposalId);
  if (!mainP) return null;
  if (mainP.outermostMainKey) {
    const nested = nestedProposals.find(
      (n) => n.stableKey === mainP.outermostMainKey && n.status !== "rejected",
    );
    if (nested) {
      return { type: "nested", nestedId: nested.id, nestedStableKey: nested.stableKey };
    }
    return { type: "error", reason: "nested_rejected" };
  }
  return { type: "proposal", id: mainP.id };
}

export function computeEffectiveMainTargets(
  draftPosts: DraftPost[],
  mainRefByDraft: Map<string, MainRef | null>,
): { directMainProposalIds: Set<string>; mainNestedIds: Set<string> } {
  const directMainProposalIds = new Set<string>();
  const mainNestedIds = new Set<string>();
  for (const draft of draftPosts) {
    const mainRef = mainRefByDraft.get(draft.id);
    if (!mainRef) continue;
    if (mainRef.type === "proposal" && draft.mainProposalId) {
      directMainProposalIds.add(draft.mainProposalId);
    } else if (mainRef.type === "nested") {
      mainNestedIds.add(mainRef.nestedId);
    }
  }
  return { directMainProposalIds, mainNestedIds };
}

export function collectMainChainKeys(
  nestedId: string,
  allNested: NestedProposalDraft[],
): Set<string> {
  const chain = new Set<string>();
  const queue = [nestedId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const edge = allNested.find((n) => n.id === id);
    if (!edge || chain.has(edge.stableKey)) continue;
    chain.add(edge.stableKey);
    const subRef = edge.subject;
    if (subRef.type === "triple") {
      const key = subRef.tripleKey;
      const child = allNested.find((n) => n.stableKey === key);
      if (child) queue.push(child.id);
    }
    const objRef = edge.object;
    if (objRef.type === "triple") {
      const key = objRef.tripleKey;
      const child = allNested.find((n) => n.stableKey === key);
      if (child) queue.push(child.id);
    }
  }
  return chain;
}
