import type { NestedProposalDraft } from "./types";

export function collectNestedAtomLabels(
  nestedProposals: NestedProposalDraft[],
): string[] {
  const out = new Set<string>();
  for (const edge of nestedProposals) {
    if (edge.predicate) out.add(edge.predicate);
    if (edge.subject.type === "atom" && edge.subject.label) out.add(edge.subject.label);
    if (edge.object.type === "atom" && edge.object.label) out.add(edge.object.label);
  }
  return Array.from(out);
}
