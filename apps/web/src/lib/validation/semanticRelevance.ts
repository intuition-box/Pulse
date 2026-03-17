export type MeaningVerdict = "preserve" | "ambiguous" | "reject";

export type MeaningGuardResult = {
  verdict: MeaningVerdict;
  reason?: string;
  lostMarkers?: string[];
};

export type MarkerCategory =
  | "negation"
  | "modal"
  | "superlative"
  | "comparative"
  | "quantifier"
  | "condition";

export type NestedEdgeContext = {
  kind: "conditional" | "meta" | "relation" | "modifier";
  text: string;
};

type RelevanceOptions = {
  contextText?: string | null;
};


export function isAllowed(r: MeaningGuardResult): boolean {
  return r.verdict === "preserve";
}

const ARTICLES = new Set(["the", "a", "an"]);

function singularVariant(word: string): string | null {
  if (word.length <= 3) return null;
  if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) return null;
  if (word.endsWith("ous") || word.endsWith("ws")) return null;
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (
    word.endsWith("xes") ||
    word.endsWith("zes") ||
    word.endsWith("ches") ||
    word.endsWith("shes")
  )
    return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
  return null;
}

function tokenize(text: string): Set<string> {
  const raw = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !ARTICLES.has(t));

  const result = new Set<string>();
  for (const t of raw) {
    result.add(t);
    const singular = singularVariant(t);
    if (singular) result.add(singular);
  }
  return result;
}

function expandContractions(text: string): string {
  return text
    .replace(/\bcan't\b/gi, "cannot")
    .replace(/\bwon't\b/gi, "will not")
    .replace(/\bshouldn't\b/gi, "should not")
    .replace(/\bmustn't\b/gi, "must not")
    .replace(/\bcouldn't\b/gi, "could not")
    .replace(/\bwouldn't\b/gi, "would not")
    .replace(/\bdoesn't\b/gi, "does not")
    .replace(/\bdon't\b/gi, "do not")
    .replace(/\bisn't\b/gi, "is not")
    .replace(/\baren't\b/gi, "are not")
    .replace(/\bwasn't\b/gi, "was not")
    .replace(/\bweren't\b/gi, "were not")
    .replace(/\bhasn't\b/gi, "has not")
    .replace(/\bhaven't\b/gi, "have not")
    .replace(/\bcannot\b/gi, "can not");
}

const NEGATION_RE = /\b(not|never|cannot)\b/gi;
const MODAL_RE = /\b(should|must|can|will|may|might|could|would)\b/gi;
const SUPERLATIVE_RE =
  /\b(best|worst|most|least|greatest|smallest|largest|highest|lowest|fastest|slowest|strongest|weakest|biggest|hardest|easiest|richest|poorest|oldest|newest|longest|shortest)\b/gi;
const COMPARATIVE_RE =
  /\b(more|less|better|worse|greater|fewer|higher|lower|bigger|smaller|faster|slower|stronger|weaker|harder|easier|richer|poorer|older|newer|longer|shorter)\b/gi;
const QUANTIFIER_RE = /\b(all|every|no|none|each|only)\b/gi;
const CONDITION_RE = /\b(if|unless|when)\b/gi;

const MARKER_REGEXES: [MarkerCategory, RegExp][] = [
  ["negation", NEGATION_RE],
  ["modal", MODAL_RE],
  ["superlative", SUPERLATIVE_RE],
  ["comparative", COMPARATIVE_RE],
  ["quantifier", QUANTIFIER_RE],
  ["condition", CONDITION_RE],
];

export function extractMarkers(text: string): Map<MarkerCategory, Set<string>> {
  const expanded = expandContractions(text);
  const result = new Map<MarkerCategory, Set<string>>();

  for (const [category, re] of MARKER_REGEXES) {
    const matches = expanded.match(re);
    if (matches && matches.length > 0) {
      result.set(category, new Set(matches.map((m) => m.toLowerCase())));
    }
  }

  return result;
}

function tokenOverlapRatio(aTokens: Set<string>, bTokens: Set<string>): number {
  if (aTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of aTokens) {
    if (bTokens.has(t)) overlap++;
  }
  return overlap / aTokens.size;
}

function countOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const t of a) {
    if (b.has(t)) count++;
  }
  return count;
}

function isTrivialVariant(token: string, bodyTokens: Set<string>): boolean {
  if (bodyTokens.has(token)) return true;
  const singular = singularVariant(token);
  if (singular && bodyTokens.has(singular)) return true;
  for (const bt of bodyTokens) {
    const bSingular = singularVariant(bt);
    if (bSingular === token) return true;
  }
  return false;
}

function findHallucinatedTokens(
  claimTokens: Set<string>,
  bodyTokens: Set<string>,
): string[] {
  const hallucinated: string[] = [];
  for (const t of claimTokens) {
    if (!isTrivialVariant(t, bodyTokens)) {
      hallucinated.push(t);
    }
  }
  return hallucinated;
}

export function checkMeaningPreservation(
  postBody: string,
  triple: { subject: string; predicate: string; object: string },
  nestedEdges?: NestedEdgeContext[],
): MeaningGuardResult {
  const tripleText = `${triple.subject} ${triple.predicate} ${triple.object}`;
  const nestedText = (nestedEdges ?? []).map((e) => e.text).join(" ");
  const fullClaimText = nestedText ? `${tripleText} ${nestedText}` : tripleText;

  const bodyTokens = tokenize(postBody);
  const claimTokens = tokenize(fullClaimText);

  if (claimTokens.size === 0) return { verdict: "preserve" };

  // Step 1: Marker comparison (by exact value)
  const bodyMarkers = extractMarkers(postBody);
  const claimMarkers = extractMarkers(fullClaimText);

  const lostMarkers: string[] = [];

  for (const [category, bodyValues] of bodyMarkers) {
    const claimValues = claimMarkers.get(category);
    if (!claimValues) {
      // Category present in body but absent from claim → marker lost
      for (const v of bodyValues) {
        lostMarkers.push(`${category}:${v}`);
      }
    } else {
      // Category present in both — check for value changes
      for (const v of bodyValues) {
        if (!claimValues.has(v)) {
          lostMarkers.push(`${category}:${v}`);
        }
      }
    }
  }

  // Check for hallucinated markers (present in claim but not in body)
  for (const [category, claimValues] of claimMarkers) {
    const bodyValues = bodyMarkers.get(category);
    if (!bodyValues) {
      for (const v of claimValues) {
        lostMarkers.push(`hallucinated_${category}:${v}`);
      }
    } else {
      for (const v of claimValues) {
        if (!bodyValues.has(v)) {
          lostMarkers.push(`hallucinated_${category}:${v}`);
        }
      }
    }
  }

  if (lostMarkers.length > 0) {
    return {
      verdict: "reject",
      reason: "The claim does not preserve the meaning of the post text.",
      lostMarkers,
    };
  }

  // Step 2: Hallucinated content tokens
  const hallucinated = findHallucinatedTokens(claimTokens, bodyTokens);
  if (hallucinated.length > 0) {
    return {
      verdict: "reject",
      reason: "The claim contains content not present in the post text.",
      lostMarkers: hallucinated.map((t) => `hallucinated_token:${t}`),
    };
  }

  // Step 3: Token overlap (fullClaimText vs body)
  const overlap = tokenOverlapRatio(claimTokens, bodyTokens);
  if (overlap >= 0.2) return { verdict: "preserve" };
  if (overlap > 0) {
    return {
      verdict: "ambiguous",
      reason: "The claim has low overlap with the post text.",
    };
  }
  return {
    verdict: "reject",
    reason: "The claim is not related to the post text.",
  };
}

export function validateAtomRelevance(
  atomLabel: string,
  postBody: string,
  field: "sText" | "pText" | "oText",
  options?: RelevanceOptions,
): MeaningGuardResult {
  if (field === "pText") return { verdict: "preserve" };

  const atomTokens = tokenize(atomLabel);
  if (atomTokens.size === 0) return { verdict: "preserve" };

  const bodyText = options?.contextText?.trim()
    ? `${postBody}\n${options.contextText.trim()}`
    : postBody;
  const bodyTokens = tokenize(bodyText);

  const overlap = countOverlap(atomTokens, bodyTokens);
  if (overlap === 0) {
    return {
      verdict: "reject",
      reason: `"${atomLabel}" is not related to the post text.`,
    };
  }
  return { verdict: "preserve" };
}

export function checkChainLabelMeaning(
  postBody: string,
  chainLabel: string,
): MeaningGuardResult {
  if (!chainLabel.trim()) {
    return { verdict: "reject", reason: "Chain label must be non-empty." };
  }

  const bodyTokens = tokenize(postBody);
  const labelTokens = tokenize(chainLabel);

  if (labelTokens.size === 0) return { verdict: "preserve" };

  // Check markers
  const bodyMarkers = extractMarkers(postBody);
  const labelMarkers = extractMarkers(chainLabel);
  const lostMarkers: string[] = [];

  for (const [category, bodyValues] of bodyMarkers) {
    const labelValues = labelMarkers.get(category);
    if (!labelValues) {
      for (const v of bodyValues) lostMarkers.push(`${category}:${v}`);
    } else {
      for (const v of bodyValues) {
        if (!labelValues.has(v)) lostMarkers.push(`${category}:${v}`);
      }
    }
  }

  if (lostMarkers.length > 0) {
    return {
      verdict: "reject",
      reason: "The claim does not preserve the meaning of the post text.",
      lostMarkers,
    };
  }

  // Token overlap
  const overlap = tokenOverlapRatio(labelTokens, bodyTokens);
  if (overlap >= 0.2) return { verdict: "preserve" };
  if (overlap > 0) {
    return { verdict: "ambiguous", reason: "The claim has low overlap with the post text." };
  }
  return { verdict: "reject", reason: "The claim is not related to the post text." };
}

export function validateBodyEdit(
  referenceText: string,
  proposedBody: string,
): MeaningGuardResult {
  if (!proposedBody.trim()) {
    return { verdict: "reject", reason: "Post body cannot be empty." };
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
        verdict: "reject",
        reason: "The proposed body text is too far from the source. It should relate to the original input.",
      };
    }
    return { verdict: "preserve" };
  }

  const forward = bodyTokens.size > 0 ? shared / bodyTokens.size : 0;
  const backward = refTokens.size > 0 ? shared / refTokens.size : 0;
  const overlap = Math.max(forward, backward);

  if (overlap < 0.12) {
    return {
      verdict: "reject",
      reason: "The proposed body text is too far from the source. It should relate to the original input.",
    };
  }

  return { verdict: "preserve" };
}

/** @deprecated Use checkMeaningPreservation instead */
export function validateTripleRelevance(
  triple: { subject: string; predicate: string; object: string },
  postBody: string,
  _options?: RelevanceOptions,
): { valid: boolean; reason?: string } {
  const r = checkMeaningPreservation(postBody, triple);
  return { valid: isAllowed(r), reason: r.reason };
}

export function getReferenceBodyForProposal(
  proposalId: string,
  draftPosts: { id: string; body: string; proposalIds: string[] }[],
): string | null {
  const draft = draftPosts.find((d) => d.proposalIds.includes(proposalId));
  return draft?.body || null;
}
