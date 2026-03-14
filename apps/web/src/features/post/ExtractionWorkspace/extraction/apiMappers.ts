import type {
  ApiProposal,
  ApiDerivedTriple,
  AtomAlternative,
  AtomMeta,
  ProposalDraft,
  NestedProposalDraft,
  DerivedTripleDraft,
  NestedTermRef,
  ProposalStatus,
  TripleRole,
  Stance,
} from "./types";
import { decisionToStatus } from "./draftHelpers";

function parseSuggestedStance(val: unknown): Stance | null {
  if (val === "SUPPORTS" || val === "REFUTES") return val;
  return null;
}

function optNum(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function parseAtomAlternative(item: unknown): AtomAlternative | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  if (typeof o.termId !== "string" || typeof o.label !== "string") return null;
  return {
    termId: o.termId,
    label: o.label,
    holders: optNum(o.holders),
    shares: optNum(o.shares),
    marketCap: optNum(o.marketCap),
    sharePrice: optNum(o.sharePrice),
  };
}

function parseAtomMeta(val: unknown): AtomMeta | null {
  if (!val || typeof val !== "object") return null;
  const obj = val as Record<string, unknown>;
  return {
    rationale: typeof obj.rationale === "string" ? obj.rationale : null,
    decisionPath: typeof obj.decisionPath === "string" ? obj.decisionPath : null,
    alternatives: Array.isArray(obj.alternatives)
      ? obj.alternatives.map(parseAtomAlternative).filter((x): x is AtomAlternative => x !== null)
      : [],
    selectedHolders: optNum(obj.selectedHolders),
    selectedShares: optNum(obj.selectedShares),
    selectedMarketCap: optNum(obj.selectedMarketCap),
    selectedSharePrice: optNum(obj.selectedSharePrice),
  };
}

export function buildProposalDraftsFromApi(
  apiProposals: ApiProposal[],
  freshExtraction = false,
): ProposalDraft[] {
  return apiProposals
    .filter((p) => p.kind !== "NESTED_TRIPLE")
    .map((proposal) => {
      const sText = (proposal.payload?.subject as string) ?? "";
      const pText = (proposal.payload?.predicate as string) ?? "";
      const oText = (proposal.payload?.object as string) ?? "";
      const rawRole = proposal.payload?.role;
      const role: TripleRole = rawRole === "MAIN" ? "MAIN" : "SUPPORTING";
      return {
        id: proposal.id,
        stableKey: (proposal.payload?.stableKey as string) ?? "",
        sText,
        pText,
        oText,
        role,
        status: freshExtraction ? ("approved" as ProposalStatus) : decisionToStatus(proposal.decision),
        subjectAtomId: (proposal.payload?.subjectTermId as string) ?? null,
        predicateAtomId: (proposal.payload?.predicateTermId as string) ?? null,
        objectAtomId: (proposal.payload?.objectTermId as string) ?? null,
        subjectConfidence: typeof proposal.payload?.subjectConfidence === "number" ? proposal.payload.subjectConfidence : null,
        predicateConfidence: typeof proposal.payload?.predicateConfidence === "number" ? proposal.payload.predicateConfidence : null,
        objectConfidence: typeof proposal.payload?.objectConfidence === "number" ? proposal.payload.objectConfidence : null,
        subjectMatchedLabel: typeof proposal.payload?.subjectMatchedLabel === "string" ? proposal.payload.subjectMatchedLabel : null,
        predicateMatchedLabel: typeof proposal.payload?.predicateMatchedLabel === "string" ? proposal.payload.predicateMatchedLabel : null,
        objectMatchedLabel: typeof proposal.payload?.objectMatchedLabel === "string" ? proposal.payload.objectMatchedLabel : null,
        subjectMeta: parseAtomMeta(proposal.payload?.subjectMeta),
        predicateMeta: parseAtomMeta(proposal.payload?.predicateMeta),
        objectMeta: parseAtomMeta(proposal.payload?.objectMeta),
        matchedIntuitionTripleTermId: proposal.matchedIntuitionTripleTermId ?? null,
        suggestedStance: parseSuggestedStance(proposal.payload?.suggestedStance),
        stanceAligned: typeof proposal.payload?.stanceAligned === "boolean" ? proposal.payload.stanceAligned : null,
        stanceReason: typeof proposal.payload?.stanceReason === "string" ? proposal.payload.stanceReason : null,
        isRelevant: typeof proposal.payload?.isRelevant === "boolean" ? proposal.payload.isRelevant : null,
        claimText: typeof proposal.payload?.claimText === "string" ? proposal.payload.claimText : "",
        sentenceText: typeof proposal.payload?.sentenceText === "string" ? proposal.payload.sentenceText : "",
        groupKey: typeof proposal.payload?.groupKey === "string" ? proposal.payload.groupKey : "0:0",
        outermostMainKey: typeof proposal.payload?.outermostMainKey === "string" ? proposal.payload.outermostMainKey : null,
        saved: {
          sText,
          pText,
          oText,
          subjectAtomId: (proposal.payload?.subjectTermId as string) ?? null,
          predicateAtomId: (proposal.payload?.predicateTermId as string) ?? null,
          objectAtomId: (proposal.payload?.objectTermId as string) ?? null,
        },
      };
    });
}

export function buildNestedDraftsFromApi(apiProposals: ApiProposal[]): NestedProposalDraft[] {
  return apiProposals
    .filter((p) => p.kind === "NESTED_TRIPLE")
    .map((p) => ({
      id: p.id,
      edgeKind: (p.payload?.edgeKind as string) ?? "",
      predicate: (p.payload?.predicate as string) ?? "",
      subject: (p.payload?.subject as NestedTermRef) ?? { type: "atom" as const, atomKey: "", label: "" },
      object: (p.payload?.object as NestedTermRef) ?? { type: "atom" as const, atomKey: "", label: "" },
      stableKey: (p.payload?.stableKey as string) ?? "",
    }));
}

export function buildDerivedTripleDraftsFromApi(raw: ApiDerivedTriple[]): DerivedTripleDraft[] {
  return raw.map((dt) => ({
    subject: dt.subject,
    predicate: dt.predicate,
    object: dt.object,
    stableKey: dt.stableKey,
    ownerGroupKey: dt.ownerGroupKey ?? "0:0",
  }));
}
