

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

type RelevanceOptions = {

  contextText?: string | null;
};

function mergedReferenceText(postBody: string, options?: RelevanceOptions): string {
  const extra = options?.contextText?.trim();
  if (!extra) return postBody;
  return `${postBody}\n${extra}`;
}

export function validateAtomRelevance(
  atomLabel: string,
  postBody: string,
  field: "sText" | "pText" | "oText",
  options?: RelevanceOptions,
): { valid: boolean; reason?: string } {

  if (field === "pText") return { valid: true };
  const atomTokens = tokenize(atomLabel);
  if (atomTokens.size === 0) return { valid: true };
  const bodyTokens = tokenize(mergedReferenceText(postBody, options));
  let overlap = 0;
  for (const t of atomTokens) {
    if (bodyTokens.has(t)) overlap++;
  }
  if (overlap === 0) {
    return { valid: false, reason: `"${atomLabel}" is not related to the post text.` };
  }
  return { valid: true };
}

export function validateTripleRelevance(
  triple: { subject: string; predicate: string; object: string },
  postBody: string,
  options?: RelevanceOptions,
): { valid: boolean; reason?: string } {
  const tripleText = `${triple.subject} ${triple.predicate} ${triple.object}`;
  const tripleTokens = tokenize(tripleText);
  const bodyTokens = tokenize(mergedReferenceText(postBody, options));
  if (tripleTokens.size === 0) return { valid: true };
  let overlap = 0;
  for (const t of tripleTokens) {
    if (bodyTokens.has(t)) overlap++;
  }
  const ratio = overlap / tripleTokens.size;
  if (ratio < 0.2) {
    return { valid: false, reason: "This claim is not related to the post text." };
  }
  return { valid: true };
}

export function getReferenceBodyForProposal(
  proposalId: string,
  draftPosts: { id: string; body: string; proposalIds: string[] }[],
): string | null {
  const draft = draftPosts.find((d) => d.proposalIds.includes(proposalId));
  return draft?.body || null;
}
