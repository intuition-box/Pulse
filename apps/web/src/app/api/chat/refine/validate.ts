

type Triple = { subject: string; predicate: string; object: string };

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function tokenOverlap(tripleTokens: Set<string>, sourceTokens: Set<string>): number {
  if (tripleTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of tripleTokens) {
    if (sourceTokens.has(t)) overlap++;
  }
  return overlap / tripleTokens.size;
}

export type GuardResult = {
  allowed: boolean;
  reason?: string;
};

export function validateSemanticGuard(
  sourceText: string,
  proposedTriple: Triple,
): GuardResult {

  const { subject, predicate, object } = proposedTriple;
  if (!subject.trim() || !predicate.trim() || !object.trim()) {
    return { allowed: false, reason: "All triple fields (subject, predicate, object) must be non-empty." };
  }

  const sourceTokens = tokenize(sourceText);
  const tripleText = `${subject} ${predicate} ${object}`;
  const tripleTokens = tokenize(tripleText);
  const overlap = tokenOverlap(tripleTokens, sourceTokens);

  if (overlap < 0.2) {
    return {
      allowed: false,
      reason: "The proposed change is too far from the source text. Claims must reflect the original input.",
    };
  }

  return { allowed: true };
}

export function validateSemanticGuardText(
  referenceText: string,
  proposedBody: string,
): GuardResult {
  if (!proposedBody.trim()) {
    return { allowed: false, reason: "Post body cannot be empty." };
  }

  const refTokens = tokenize(referenceText);
  const bodyTokens = tokenize(proposedBody);

  let shared = 0;
  for (const t of bodyTokens) {
    if (refTokens.has(t)) shared++;
  }

  if (bodyTokens.size < 10) {
    if (shared === 0) {
      return {
        allowed: false,
        reason: "The proposed body text is too far from the source. It should relate to the original input.",
      };
    }
    return { allowed: true };
  }

  const forward = bodyTokens.size > 0 ? shared / bodyTokens.size : 0;
  const backward = refTokens.size > 0 ? shared / refTokens.size : 0;
  const overlap = Math.max(forward, backward);

  if (overlap < 0.12) {
    return {
      allowed: false,
      reason: "The proposed body text is too far from the source. It should relate to the original input.",
    };
  }

  return { allowed: true };
}
