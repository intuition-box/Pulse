import type {
  DraftPost,
  DerivedTripleDraft,
  MatchedTree,
  NestedProposalDraft,
  NestedTermRef,
  ProposalDraft,
} from "./types";

// Build a MatchedTree from the extracted proposals + nested edges + derived triples.
export function buildExtractedTree(
  draft: DraftPost,
  proposals: ProposalDraft[],
  nestedProposals: NestedProposalDraft[],
  derivedTriples: DerivedTripleDraft[],
): MatchedTree | null {
  const mainProposal = proposals.find((p) => p.id === draft.mainProposalId);
  if (!mainProposal) return null;

  // Find the outermost nested edge (if any)
  const outermostKey = mainProposal.outermostMainKey;
  if (!outermostKey) {
    return null;
  }

  const proposalByStableKey = new Map(proposals.map((p) => [p.stableKey, p]));
  const nestedByStableKey = new Map(nestedProposals.map((e) => [e.stableKey, e]));
  const derivedByStableKey = new Map(derivedTriples.map((dt) => [dt.stableKey, dt]));

  function resolveRef(ref: NestedTermRef, seen: Set<string>): MatchedTree | string {
    if (ref.type === "atom") {
      return ref.label;
    }

    if (seen.has(ref.tripleKey)) {
      return ref.label ?? ref.tripleKey;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(ref.tripleKey);

    const proposal = proposalByStableKey.get(ref.tripleKey);
    if (proposal) {
      return {
        subject: proposal.sText,
        predicate: proposal.pText,
        object: proposal.oText,
      };
    }

    const edge = nestedByStableKey.get(ref.tripleKey);
    if (edge) {
      return resolveEdge(edge, nextSeen);
    }

    const derived = derivedByStableKey.get(ref.tripleKey);
    if (derived) {
      return {
        subject: derived.subject,
        predicate: derived.predicate,
        object: derived.object,
      };
    }

    return ref.label ?? ref.tripleKey;
  }

  function resolveEdge(edge: NestedProposalDraft, seen: Set<string>): MatchedTree {
    const subjectResult = resolveRef(edge.subject, seen);
    const objectResult = resolveRef(edge.object, seen);

    return {
      subject: typeof subjectResult === "string" ? subjectResult : subjectResult.subject,
      predicate: edge.predicate,
      object: typeof objectResult === "string" ? objectResult : objectResult.object,
      subjectNested: typeof subjectResult === "string" ? undefined : subjectResult,
      objectNested: typeof objectResult === "string" ? undefined : objectResult,
    };
  }

  // Find the outermost edge
  const rootEdge = nestedByStableKey.get(outermostKey);
  if (!rootEdge) return null;

  return resolveEdge(rootEdge, new Set([rootEdge.stableKey]));
}
