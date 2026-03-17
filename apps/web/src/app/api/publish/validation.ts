

export const MAX_BODY_LENGTH = 5000;

export type TripleInput = {
  proposalId: string;
  tripleTermId: string;
  isExisting: boolean;
  role: "MAIN" | "SUPPORTING";
  stableKey?: string;

  sLabel?: string;
  pLabel?: string;
  oLabel?: string;
};

export function isValidTriple(value: unknown): value is TripleInput {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.proposalId === "string" &&
    typeof t.tripleTermId === "string" &&
    typeof t.isExisting === "boolean" &&
    (t.role === "MAIN" || t.role === "SUPPORTING") &&
    (t.stableKey === undefined || typeof t.stableKey === "string")
  );
}

export type NestedTripleInput = {
  nestedProposalId: string;
  tripleTermId: string;
  isExisting: boolean;
  role?: "MAIN" | "SUPPORTING";
  chainLabel?: string;
  edgeKind?: string;
  ownerStableKey?: string;
};

export function isValidNestedTriple(value: unknown): value is NestedTripleInput {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.nestedProposalId === "string" &&
    typeof t.tripleTermId === "string" &&
    typeof t.isExisting === "boolean" &&
    (t.role === undefined || t.role === "MAIN" || t.role === "SUPPORTING") &&
    (t.chainLabel === undefined || typeof t.chainLabel === "string") &&
    (t.edgeKind === undefined || typeof t.edgeKind === "string") &&
    (t.ownerStableKey === undefined || typeof t.ownerStableKey === "string")
  );
}

export type DraftPostPayload = {
  draftId: string;
  body: string;
  stance?: string | null;
  triples: TripleInput[];
  nestedTriples?: NestedTripleInput[];
};

const VALID_STANCES = new Set(["SUPPORTS", "REFUTES"]);

export function isValidDraftPost(value: unknown): value is DraftPostPayload {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.draftId === "string" &&
    typeof d.body === "string" &&
    d.body.length <= MAX_BODY_LENGTH &&
    (d.stance === undefined || d.stance === null || (typeof d.stance === "string" && VALID_STANCES.has(d.stance))) &&
    Array.isArray(d.triples) &&
    (d.triples.length > 0 ||
      (Array.isArray(d.nestedTriples) && d.nestedTriples.length > 0)) &&
    d.triples.every(isValidTriple) &&
    (d.nestedTriples === undefined ||
      (Array.isArray(d.nestedTriples) && d.nestedTriples.every(isValidNestedTriple)))
  );
}
