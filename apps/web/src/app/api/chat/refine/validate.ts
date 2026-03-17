import {
  checkMeaningPreservation,
  checkChainLabelMeaning,
  validateBodyEdit,
  isAllowed,
  type NestedEdgeContext,
} from "@/lib/validation/semanticRelevance";

type Triple = { subject: string; predicate: string; object: string };

export type GuardResult = {
  allowed: boolean;
  reason?: string;
};

export function validateSemanticGuard(
  sourceText: string,
  proposed: Triple | { chainLabel: string },
  nestedEdges?: NestedEdgeContext[],
): GuardResult {
  if ("chainLabel" in proposed) {
    if (!proposed.chainLabel.trim()) {
      return { allowed: false, reason: "Nested claim label must be non-empty." };
    }
    const r = checkChainLabelMeaning(sourceText, proposed.chainLabel);
    return { allowed: isAllowed(r), reason: r.reason };
  }

  const { subject, predicate, object } = proposed;
  if (!subject.trim() || !predicate.trim() || !object.trim()) {
    return { allowed: false, reason: "All triple fields (subject, predicate, object) must be non-empty." };
  }

  const r = checkMeaningPreservation(sourceText, { subject, predicate, object }, nestedEdges);
  return { allowed: isAllowed(r), reason: r.reason };
}

export function validateSemanticGuardText(
  referenceText: string,
  proposedBody: string,
): GuardResult {
  const r = validateBodyEdit(referenceText, proposedBody);
  return { allowed: isAllowed(r), reason: r.reason };
}
