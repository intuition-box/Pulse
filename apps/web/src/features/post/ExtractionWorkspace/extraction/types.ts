export type Stance = "SUPPORTS" | "REFUTES";

export type ProposalStatus = "pending" | "approved" | "rejected";

export type TripleRole = "MAIN" | "SUPPORTING";

export type AtomAlternative = {
  termId: string;
  label: string;
  holders: number | null;
  shares: number | null;
  marketCap: number | null;
  sharePrice: number | null;
};

export type AtomMeta = {
  rationale: string | null;
  decisionPath: string | null;
  alternatives: AtomAlternative[];
  selectedHolders: number | null;
  selectedShares: number | null;
  selectedMarketCap: number | null;
  selectedSharePrice: number | null;
};

export type ProposalDraft = {
  id: string;
  stableKey: string;
  sText: string;
  pText: string;
  oText: string;
  role: TripleRole;
  status: ProposalStatus;
  subjectAtomId: string | null;
  predicateAtomId: string | null;
  objectAtomId: string | null;
  subjectConfidence: number | null;
  predicateConfidence: number | null;
  objectConfidence: number | null;
  subjectMatchedLabel: string | null;
  predicateMatchedLabel: string | null;
  objectMatchedLabel: string | null;
  subjectMeta: AtomMeta | null;
  predicateMeta: AtomMeta | null;
  objectMeta: AtomMeta | null;
  matchedIntuitionTripleTermId?: string | null;
  suggestedStance: Stance | null;
  stanceAligned: boolean | null;
  stanceReason: string | null;

  isRelevant: boolean | null;
  claimText: string;
  sentenceText: string;
  groupKey: string;

  outermostMainKey: string | null;
  saved: {
    sText: string;
    pText: string;
    oText: string;
    subjectAtomId: string | null;
    predicateAtomId: string | null;
    objectAtomId: string | null;
  };
};

export type ApprovedProposalWithRole = ProposalDraft & { role: TripleRole };

export type DraftPost = {
  id: string;
  stance: Stance | null;
  mainProposalId: string | null;
  proposalIds: string[];
  body: string;
  bodyDefault: string;
};

export type NestedTermRef =
  | { type: "atom"; atomKey: string; label: string }
  | { type: "triple"; tripleKey: string; label?: string };

export type NestedProposalStatus = "approved" | "rejected";

export type NestedEdgeLike = {
  stableKey: string;
  edgeKind: string;
  predicate: string;
  subject: { type: string; tripleKey?: string; label?: string };
  object: { type: string; tripleKey?: string; label?: string };
};

export type NestedProposalDraft = NestedEdgeLike & {
  id: string;
  subject: NestedTermRef;
  object: NestedTermRef;
  status?: NestedProposalStatus;
};

export type DerivedTripleDraft = {
  subject: string;
  predicate: string;
  object: string;
  stableKey: string;
  ownerGroupKey: string;
};

export type PropagationResult = { updatedClaims: number; updatedPosts: number };

export type ProposalActions = {
  onChange: (proposalId: string, field: "sText" | "pText" | "oText", value: string) => void;
  onSave: (proposalId: string) => void;
  onSelectMain: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
  onLock: (proposalId: string, field: "sText" | "pText" | "oText", atomId: string, label: string, metrics?: { holders: number | null; marketCap: number | null }) => void;
  onUnlock: (proposalId: string, field: "sText" | "pText" | "oText") => void;
  onAddDraft: (targetDraftId?: string) => void;
  onAddTriple: (subject: string, predicate: string, object: string, targetDraftId?: string) => void;
  onPropagateAtom: (sourceSlotText: string, atomId: string, label: string, metrics?: { holders: number | null; marketCap: number | null }) => PropagationResult;
  onSetNewTermLocal: (proposalId: string, field: "sText" | "pText" | "oText", label: string) => void;
};

export type DraftActions = {
  onSplit: () => void;
  onStanceChange: (draftId: string, stance: Stance) => void;
  onBodyChange: (draftId: string, body: string) => void;
  onBodyReset: (draftId: string) => void;
  onRemove: (draftId: string) => void;
};

export type ResolvedTriple = {
  proposalId: string;
  role: TripleRole;
  subjectAtomId: string;
  predicateAtomId: string;
  objectAtomId: string;
  tripleTermId: string;
  isExisting: boolean;
};

export type ResolvedNestedTriple = {
  nestedProposalId: string;
  subjectTermId: string;
  predicateTermId: string;
  objectTermId: string;
  tripleTermId: string;
  isExisting: boolean;
};

export type NestedTriplePayloadItem = {
  nestedProposalId: string;
  tripleTermId: string;
  isExisting: boolean;
};

export type DraftPublishPayload = {
  draftId: string;
  body: string;
  stance: Stance | null;
  triples: { proposalId: string; tripleTermId: string; isExisting: boolean; role: TripleRole; stableKey?: string; sLabel?: string; pLabel?: string; oLabel?: string }[];
  nestedTriples: { nestedProposalId: string; tripleTermId: string; isExisting: boolean; role?: TripleRole; chainLabel?: string; edgeKind?: string; ownerStableKey?: string }[];
};

export type BatchOnchainResult = {
  triples: ResolvedTriple[];
  atomTxHash: string | null;
  tripleTxHash: string | null;
  stanceTxHash: string | null;
};

export type ExtractionJobSummary = {
  id: string;
  status: string;
  inputText?: string;
  parentPostId?: string | null;
  stance?: Stance | null;
  parentMainTripleTermId?: string | null;
};

export type PublishSummary = {
  id: string;
  publishedAt: string;
};

export type TxPlanItem = {
  id: string;
  kind: "atom" | "triple";
  intuitionId: string;
  status: "pending" | "published" | "failed";
  txHash?: string | null;
  error: string | null;
};

export type ApprovedTripleStatusState = "idle" | "checking" | "ready" | "error";

export type ApprovedTripleStatus = {
  proposalId: string;
  tripleTermId: string | null;
  isExisting: boolean;
};

export type DepositState =
  | { status: "idle" }
  | { status: "depositing" }
  | { status: "confirmed"; txHash: string; count: number }
  | { status: "failed"; error: string };

export type ExtractionContext = {
  inputText: string;
  parentPostId: string | null;
  stance: Stance | null;
};

export type HexString = `0x${string}`;

export type UseExtractionFlowParams = {
  themeSlug: string;
  parentPostId: string | null;
  parentMainTripleTermId?: string | null;
  themeAtomTermId?: string | null;
  onPublishSuccess?: (postId: string) => void;

  themeTitle?: string;

  parentClaim?: string;
};

export type ApiProposal = {
  id: string;
  kind?: string;
  payload: Record<string, unknown>;
  decision: string;
  matchedIntuitionTripleTermId?: string | null;
};

export type ApiDerivedTriple = {
  subject: string;
  predicate: string;
  object: string;
  stableKey: string;
  ownerGroupKey?: string;
};
