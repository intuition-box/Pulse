

export type VaultMetrics = {
  holders: number | null;
  shares: number | null;
  marketCap: number | null;
  sharePrice: number | null;
};

export type AtomResult = { termId: string; label: string; tripleCount?: number | null } & VaultMetrics;

export type TripleResult = {
  termId: string;
  subject: string;
  predicate: string;
  object: string;
} & VaultMetrics & {
  counterHolders: number | null;
  counterShares: number | null;
  counterMarketCap: number | null;
  counterSharePrice: number | null;
};

export type AtomSuggestion = {
  id: string;
  label: string;
  source: "global" | "semantic" | "graphql";
  tripleCount?: number | null;
} & VaultMetrics;

export type TripleSuggestion = {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  subjectId?: string | null;
  predicateId?: string | null;
  objectId?: string | null;
  source: "global" | "semantic" | "graphql" | "exact";
} & VaultMetrics & {
  counterHolders: number | null;
  counterShares: number | null;
  counterMarketCap: number | null;
  counterSharePrice: number | null;
  isExactMatch?: boolean;
};

export type SearchResultsPayload = {
  kind: "atoms" | "triples";
  query: string;
  results: AtomResult[] | TripleResult[];
  context?: { proposalId: string; field: "subject" | "predicate" | "object" };
};

export type QuickAction = { label: string; message: string };
