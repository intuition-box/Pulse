import type { MatchedTree, NestedProposalDraft, NestedTermRef, ProposalDraft } from "./types";

export type RewriteResult = {
  proposals: ProposalDraft[];
  nestedProposals: NestedProposalDraft[];
  mainProposalId: string;
};


// Deterministic stable key from S/P/O labels.

function makeRewriteStableKey(s: string, p: string, o: string): string {
  return `rw:${s.toLowerCase()}|${p.toLowerCase()}|${o.toLowerCase()}`;
}

let rewriteCounter = 0;
function makeRewriteId(mainId: string): string {
  return `rewrite-${mainId}-${++rewriteCounter}`;
}

function makeProposalFromTree(
  id: string,
  tree: MatchedTree,
  template: ProposalDraft,
  role: "MAIN" | "SUPPORTING",
  outermostMainKey: string | null,
  matchedTripleTermId: string | null,
): ProposalDraft {
  return {
    id,
    stableKey: makeRewriteStableKey(tree.subject, tree.predicate, tree.object),
    sText: tree.subject,
    pText: tree.predicate,
    oText: tree.object,
    role,
    status: "approved",
    subjectAtomId: null,
    predicateAtomId: null,
    objectAtomId: null,
    subjectConfidence: null,
    predicateConfidence: null,
    objectConfidence: null,
    subjectMatchedLabel: null,
    predicateMatchedLabel: null,
    objectMatchedLabel: null,
    subjectMeta: null,
    predicateMeta: null,
    objectMeta: null,
    matchedIntuitionTripleTermId: matchedTripleTermId,
    suggestedStance: template.suggestedStance,
    stanceAligned: template.stanceAligned,
    stanceReason: template.stanceReason,
    isRelevant: template.isRelevant,
    claimText: template.claimText,
    sentenceText: template.sentenceText,
    groupKey: template.groupKey,
    outermostMainKey,
    saved: {
      sText: tree.subject,
      pText: tree.predicate,
      oText: tree.object,
      subjectAtomId: null,
      predicateAtomId: null,
      objectAtomId: null,
    },
  };
}

// Recursively walk a MatchedTree node and produce ProposalDrafts + NestedProposalDrafts.

function walkTree(
  tree: MatchedTree,
  mainId: string,
  template: ProposalDraft,
  proposals: ProposalDraft[],
  nestedEdges: NestedProposalDraft[],
): NestedTermRef {
  const hasNesting = !!tree.subjectNested || !!tree.objectNested;

  if (!hasNesting) {
    const pid = makeRewriteId(mainId);
    const proposal = makeProposalFromTree(pid, tree, template, "SUPPORTING", null, tree.termId ?? null);
    proposals.push(proposal);
    return { type: "triple", tripleKey: proposal.stableKey };
  }

  const subjectRef: NestedTermRef = tree.subjectNested
    ? walkTree(tree.subjectNested, mainId, template, proposals, nestedEdges)
    : { type: "atom", atomKey: `rw-atom:${tree.subject.toLowerCase()}`, label: tree.subject };

  const objectRef: NestedTermRef = tree.objectNested
    ? walkTree(tree.objectNested, mainId, template, proposals, nestedEdges)
    : { type: "atom", atomKey: `rw-atom:${tree.object.toLowerCase()}`, label: tree.object };

  const edgeKey = makeRewriteStableKey(
    subjectRef.type === "triple" ? subjectRef.tripleKey : subjectRef.label,
    tree.predicate,
    objectRef.type === "triple" ? objectRef.tripleKey : (objectRef as { label: string }).label,
  );

  const edge: NestedProposalDraft = {
    id: makeRewriteId(mainId),
    stableKey: edgeKey,
    edgeKind: "modifier",
    predicate: tree.predicate,
    subject: subjectRef,
    object: objectRef,
    status: "approved",
    matchedTripleTermId: tree.termId,
  };
  nestedEdges.push(edge);

  return { type: "triple", tripleKey: edge.stableKey };
}


// Rebuild a draft's proposals and nested edges from an on-chain MatchedTree.

export function rebuildDraftFromMatchedTree(
  tree: MatchedTree,
  existingMainProposal: ProposalDraft,
  termId: string,
): RewriteResult {
  const hasNesting = !!tree.subjectNested || !!tree.objectNested;

  if (!hasNesting) {
    const proposal = makeProposalFromTree(
      existingMainProposal.id, tree, existingMainProposal,
      "MAIN", null, termId,
    );
    return { proposals: [proposal], nestedProposals: [], mainProposalId: proposal.id };
  }

  const proposals: ProposalDraft[] = [];
  const nestedEdges: NestedProposalDraft[] = [];

  const subjectRef: NestedTermRef = tree.subjectNested
    ? walkTree(tree.subjectNested, existingMainProposal.id, existingMainProposal, proposals, nestedEdges)
    : { type: "atom", atomKey: `rw-atom:${tree.subject.toLowerCase()}`, label: tree.subject };

  const objectRef: NestedTermRef = tree.objectNested
    ? walkTree(tree.objectNested, existingMainProposal.id, existingMainProposal, proposals, nestedEdges)
    : { type: "atom", atomKey: `rw-atom:${tree.object.toLowerCase()}`, label: tree.object };

  const rootEdgeKey = makeRewriteStableKey(
    subjectRef.type === "triple" ? subjectRef.tripleKey : subjectRef.label,
    tree.predicate,
    objectRef.type === "triple" ? objectRef.tripleKey : (objectRef as { label: string }).label,
  );
  const rootEdge: NestedProposalDraft = {
    id: makeRewriteId(existingMainProposal.id),
    stableKey: rootEdgeKey,
    edgeKind: "modifier",
    predicate: tree.predicate,
    subject: subjectRef,
    object: objectRef,
    status: "approved",
    matchedTripleTermId: termId,
  };
  nestedEdges.push(rootEdge);

  const mainProposal = makeProposalFromTree(
    existingMainProposal.id,
    tree,
    existingMainProposal,
    "MAIN",
    rootEdge.stableKey, // outermostMainKey
    termId,
  );
  proposals.push(mainProposal);

  return { proposals, nestedProposals: nestedEdges, mainProposalId: mainProposal.id };
}
