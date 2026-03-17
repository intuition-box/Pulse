import { z } from "zod";
import type { NestedEdge } from "./core.js";

export const FlatTripleSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
});
export type FlatTriple = z.infer<typeof FlatTripleSchema>;

import type { AtomMatchDecisionPath } from "./search/types.js";

export type AtomMatchAlternative = {
  termId: string;
  label: string;
  holders: number | null;
  shares: number | null;
  marketCap: number | null;
  sharePrice: number | null;
};

export type AtomMatchMeta = {
  rationale?: string | null;
  decisionPath?: AtomMatchDecisionPath | null;
  alternatives?: AtomMatchAlternative[];
  selectedHolders?: number | null;
  selectedShares?: number | null;
  selectedMarketCap?: number | null;
  selectedSharePrice?: number | null;
};

export type ClaimAtomMatches = {
  subjectTermId?: string | null;
  predicateTermId?: string | null;
  objectTermId?: string | null;
  subjectConfidence?: number;
  predicateConfidence?: number;
  objectConfidence?: number;

  subjectMatchedLabel?: string | null;
  predicateMatchedLabel?: string | null;
  objectMatchedLabel?: string | null;

  subjectMeta?: AtomMatchMeta;
  predicateMeta?: AtomMatchMeta;
  objectMeta?: AtomMatchMeta;
};

export type DerivedTriple = FlatTriple & { stableKey: string; ownerGroupKey: string };

export type RejectionCode =
  | "OFF_TOPIC"
  | "NOT_DEBATABLE"
  | "GIBBERISH"
  | "NO_MAIN_CLAIMS"
  | "NO_NEW_INFORMATION"
  | "LLM_UNAVAILABLE";

export type ExtractionResult = {
  perSegment: Array<{
    headerPath: string[];
    sentence: string;
    selectedSentence: string | null;
    claims: Array<{
      index: number;
      claim: string;
      role: "MAIN" | "SUPPORTING";
      group: number;
      triple: (FlatTriple & { stableKey: string } & ClaimAtomMatches) | null;

      outermostMainKey?: string | null;
      suggestedStance?: "SUPPORTS" | "REFUTES";
      stanceAligned?: boolean;
      stanceReason?: string;

      isRelevant?: boolean;
    }>;
  }>;
  nested: NestedEdge[];

  derivedTriples: DerivedTriple[];
  llmCallCount: number;

  rejection?: {
    code: RejectionCode;
    detail?: string;
  };
};

export type ExtractionOptions = {
  themeTitle?: string | null;
  parentClaimText?: string | null;
  userStance?: "SUPPORTS" | "REFUTES" | null;
  searchFn?: import("./search/types.js").SearchFn;
};

export type DecomposedClaim = {
  text: string;
  role: "MAIN" | "SUPPORTING";
  group: number;

  candidateKind?: "causal" | "conditional" | "meta" | "standard" | null;

  confidence?: number | null;
};

export type Conditional = {
  kw: "if" | "unless" | "when";
  condText: string;
  mainText: string;

  compoundKw?: string;
};

export type Causal = {
  marker: "because" | "since";
  mainText: string;
  reasonText: string;
};

export type ClaimNode =
  | { kind: "proposition"; text: string; role: "MAIN" | "SUPPORTING"; group: number }
  | { kind: "clause"; text: string }
  | { kind: "meta"; source: string; verb: string; child: ClaimNode }
  | { kind: "conditional"; main: ClaimNode; condition: ClaimNode; kw: string; compoundKw?: string }
  | { kind: "causal"; main: ClaimNode; reason: ClaimNode; marker: "because" | "since" };

export type ClaimTreeLeaf = {
  leafId: string;
  text: string;
};

export type ClaimTreePlan = {
  tree: ClaimNode;
  claim: string;
  role: "MAIN" | "SUPPORTING";
  group: number;
  leaves: ClaimTreeLeaf[];
  graphKeys: string[];
};

export type TreeProcessResult = {
  ref: import("./core.js").TermRef;
  stableKey: string | null;
  anchorTriple: (FlatTriple & { stableKey: string }) | null;
  graphable: boolean;
};
