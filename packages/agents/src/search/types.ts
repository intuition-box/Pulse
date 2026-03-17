
export type AtomCandidate = {
  termId: string;
  label: string;
  source: "global" | "semantic" | "graphql" | "exact_onchain";
  holders: number | null;
  shares: number | null;
  marketCap: number | null;
  sharePrice: number | null;
};

export type AtomMatchDecisionPath =
  | "cache_hit"
  | "strict_equivalent"
  | "anti_dup"
  | "high_score"
  | "llm_review"
  | "no_candidates"
  | "search_unavailable"
  | "no_llm_fallback";

export type AtomMatch = {
  position: "subject" | "predicate" | "object";
  rawLabel: string;
  choice: "existing" | "new";
  termId: string | null;
  label: string;
  confidence: number;
  rationale?: string;
  decisionPath?: AtomMatchDecisionPath;
  alternatives?: AtomCandidate[];
};

export type PositionThresholds = {
  high: number;
  low: number;
};

export type SearchFn = (query: string, limit: number) => Promise<AtomCandidate[]>;
