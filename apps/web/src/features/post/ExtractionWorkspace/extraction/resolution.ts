import type { ResolvedTriple, ApprovedProposalWithRole } from "./types";

export function buildResolvedTripleMap(
  resolvedByIndex: Array<ResolvedTriple | null>,
  approvedProposals: ApprovedProposalWithRole[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < approvedProposals.length; i++) {
    const resolved = resolvedByIndex[i];
    if (resolved && approvedProposals[i].stableKey) {
      map.set(approvedProposals[i].stableKey, resolved.tripleTermId);
    }
  }
  return map;
}
