import type { AtomCandidate } from "@db/agents/search/types";
import type { TripleResult, AtomSuggestion, TripleSuggestion } from "./types";
import type { PublicClient, Address } from "viem";
import { stringToHex } from "viem";
import { MultiVaultAbi } from "@0xintuition/protocol";
import { parseVaultMetrics } from "./metrics";
import {
  type GraphqlAtom,
  type GraphqlTriple,
  TRIPLE_QUERY,
  fetchAtomsByWhere,
  fetchSemanticAtoms as fetchSemanticAtomsRaw,
  parseTripleCount,
} from "./graphql-queries";
import { intuitionGraphqlUrl } from "./intuition";

function atomToCandidate(atom: GraphqlAtom, source: "graphql" | "semantic"): AtomCandidate | null {
  const termId = atom.term_id;
  const label = atom.label?.trim();
  if (!termId || !label || label.startsWith("0x")) return null;

  const m = parseVaultMetrics(atom.term?.vaults?.[0]);
  return { termId, label, source, ...m };
}

export function graphqlAtomToSuggestion(atom: GraphqlAtom, source: "graphql" | "semantic"): AtomSuggestion | null {
  const rawLabel = atom?.label ?? atom?.data ?? "";
  const label = typeof rawLabel === "string" ? rawLabel.trim() : "";
  const id = typeof atom.term_id === "string" ? atom.term_id : "";
  if (!id || !label) return null;

  const m = parseVaultMetrics(atom.term?.vaults?.[0]);
  const tripleCount = parseTripleCount(atom) || null;
  return { id, label, source, ...m, tripleCount };
}

export function graphqlTripleToSuggestion(triple: GraphqlTriple): TripleSuggestion | null {
  const id = triple.term_id;
  if (!id) return null;

  const subject = triple.subject?.label ?? "";
  const predicate = triple.predicate?.label ?? "";
  const object = triple.object?.label ?? "";
  if (!subject && !predicate && !object) return null;

  const pro = parseVaultMetrics(triple.term?.vaults?.[0]);
  const counter = parseVaultMetrics(triple.counter_term?.vaults?.[0]);

  return {
    id,
    subject,
    predicate,
    object,
    subjectId: triple.subject?.term_id ?? null,
    predicateId: triple.predicate?.term_id ?? null,
    objectId: triple.object?.term_id ?? null,
    source: "graphql" as const,
    ...pro,
    counterHolders: counter.holders,
    counterShares: counter.shares,
    counterMarketCap: counter.marketCap,
    counterSharePrice: counter.sharePrice,
  };
}

/* ── Exact on-chain atom lookup ── */

export type ExactLookupConfig = {
  publicClient: PublicClient;
  multivaultAddress: Address;
  normalizeLabel: (label: string) => string;
};

export async function findExactAtomCandidates(
  label: string,
  config: ExactLookupConfig,
): Promise<AtomCandidate[]> {
  const { publicClient, multivaultAddress, normalizeLabel } = config;
  const normalized = normalizeLabel(label);
  const raw = label.trim();

  const forms = [normalized];
  if (raw !== normalized) forms.push(raw);

  const candidates: AtomCandidate[] = [];
  const seenIds = new Set<string>();

  for (const form of forms) {
    try {
      const hex = stringToHex(form);
      const atomId = await publicClient.readContract({
        address: multivaultAddress,
        abi: MultiVaultAbi,
        functionName: "calculateAtomId",
        args: [hex],
      });
      const exists = await publicClient.readContract({
        address: multivaultAddress,
        abi: MultiVaultAbi,
        functionName: "isTermCreated",
        args: [atomId],
      });
      if (exists) {
        const termId = String(atomId);
        if (!seenIds.has(termId)) {
          seenIds.add(termId);
          candidates.push({
            termId,
            label: form,
            source: "exact_onchain",
            holders: null,
            shares: null,
            marketCap: null,
            sharePrice: null,
          });
        }
      }
    } catch {
      // RPC failure — skip this form silently
    }
  }

  return candidates;
}

export async function hydrateExactCandidates(
  candidates: AtomCandidate[],
  graphqlCandidates: AtomCandidate[],
): Promise<AtomCandidate[]> {
  // Build lookup from GraphQL candidates by termId
  const graphqlById = new Map<string, AtomCandidate>();
  for (const c of graphqlCandidates) {
    graphqlById.set(c.termId, c);
  }

  const needsHydration: AtomCandidate[] = [];
  for (const c of candidates) {
    const gql = graphqlById.get(c.termId);
    if (gql) {
      // Merge stats from GraphQL
      c.holders = gql.holders;
      c.shares = gql.shares;
      c.marketCap = gql.marketCap;
      c.sharePrice = gql.sharePrice;
    } else {
      needsHydration.push(c);
    }
  }

  // Batch hydrate remaining candidates via GraphQL
  if (needsHydration.length > 0) {
    try {
      const atoms = await fetchAtomsByWhere(
        { term_id: { _in: needsHydration.map((c) => c.termId) } },
        needsHydration.length,
      );
      for (const atom of atoms) {
        const c = needsHydration.find((n) => n.termId === atom.term_id);
        if (c) {
          const m = parseVaultMetrics(atom.term?.vaults?.[0]);
          c.holders = m.holders;
          c.shares = m.shares;
          c.marketCap = m.marketCap;
          c.sharePrice = m.sharePrice;
          if (atom.label) c.label = atom.label.trim();
        }
      }
    } catch {
      // GraphQL hydration failed — stats stay null, not blocking
    }
  }

  return candidates;
}

async function fetchExactAtoms(query: string): Promise<AtomCandidate[]> {
  const atoms = await fetchAtomsByWhere({ label: { _ilike: query } }, 5);
  return atoms.map((a) => atomToCandidate(a, "graphql")).filter((c): c is AtomCandidate => c !== null);
}

async function fetchFuzzyAtoms(query: string, limit: number): Promise<AtomCandidate[]> {
  const atoms = await fetchAtomsByWhere({ label: { _ilike: `%${query}%` } }, limit);
  return atoms.map((a) => atomToCandidate(a, "graphql")).filter((c): c is AtomCandidate => c !== null);
}

async function fetchSemanticAtomsAsCandidate(query: string, limit: number): Promise<AtomCandidate[]> {
  try {
    const atoms = await fetchSemanticAtomsRaw(query, limit);
    return atoms
      .map((a) => atomToCandidate(a, "semantic"))
      .filter((c): c is AtomCandidate => c !== null);
  } catch (err) {
    console.warn(`[atom-search] Semantic error for "${query}":`, err instanceof Error ? err.message : err);
    return [];
  }
}

export async function searchAtomsServer(
  query: string,
  limit: number,
  exactLookupConfig?: ExactLookupConfig,
): Promise<AtomCandidate[]> {
  const sources: Promise<AtomCandidate[]>[] = [
    fetchExactAtoms(query),
    fetchFuzzyAtoms(query, limit),
    fetchSemanticAtomsAsCandidate(query, limit),
  ];

  // If on-chain lookup config is provided, run exact on-chain check in parallel
  if (exactLookupConfig) {
    sources.push(
      findExactAtomCandidates(query, exactLookupConfig).catch(() => []),
    );
  }

  const results = await Promise.all(sources);

  // Exact on-chain candidates come first (higher priority in dedup)
  // But they lack stats — merge holders/marketCap from GraphQL when available
  const byId = new Map<string, AtomCandidate>();
  // Reverse so exact_onchain (last in array) wins dedup over graphql
  for (const batch of [...results].reverse()) {
    for (const c of batch) {
      const existing = byId.get(c.termId);
      if (!existing) {
        byId.set(c.termId, c);
      } else if (existing.source === "exact_onchain" && c.source !== "exact_onchain") {
        // Hydrate exact_onchain candidate with stats from GraphQL/semantic
        existing.holders ??= c.holders;
        existing.shares ??= c.shares;
        existing.marketCap ??= c.marketCap;
        existing.sharePrice ??= c.sharePrice;
      }
    }
  }

  // Batch-hydrate exact_onchain candidates that still lack stats
  const unhydrated = Array.from(byId.values()).filter(
    (c) => c.source === "exact_onchain" && c.holders == null,
  );
  if (unhydrated.length > 0) {
    try {
      const atoms = await fetchAtomsByWhere(
        { term_id: { _in: unhydrated.map((c) => c.termId) } },
        unhydrated.length,
      );
      for (const atom of atoms) {
        const c = unhydrated.find((u) => u.termId === atom.term_id);
        if (c) {
          const m = parseVaultMetrics(atom.term?.vaults?.[0]);
          c.holders ??= m.holders;
          c.shares ??= m.shares;
          c.marketCap ??= m.marketCap;
          c.sharePrice ??= m.sharePrice;
          if (atom.label) c.label = atom.label.trim();
        }
      }
    } catch {
      // GraphQL hydration failed — stats stay null, not blocking
    }
  }

  return Array.from(byId.values()).slice(0, limit);
}

export type TripleSearchResult = TripleResult;

export async function searchTriplesServer(
  query: string,
  limit: number,
): Promise<TripleSearchResult[]> {
  try {
    const res = await fetch(intuitionGraphqlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: TRIPLE_QUERY,
        variables: {
          where: {
            _or: [
              { subject: { label: { _ilike: `%${query}%` } } },
              { predicate: { label: { _ilike: `%${query}%` } } },
              { object: { label: { _ilike: `%${query}%` } } },
            ],
          },
          limit,
        },
      }),
      cache: "no-store",
    });

    if (!res.ok) return [];
    const payload = await res.json();
    const triples = Array.isArray(payload?.data?.triples)
      ? (payload.data.triples as GraphqlTriple[])
      : [];

    return triples
      .map((t): TripleSearchResult | null => {
        const termId = t.term_id;
        const subject = t.subject?.label?.trim();
        const predicate = t.predicate?.label?.trim();
        const object = t.object?.label?.trim();
        if (!termId || !subject || !predicate || !object) return null;

        const pro = parseVaultMetrics(t.term?.vaults?.[0]);
        const counter = parseVaultMetrics(t.counter_term?.vaults?.[0]);

        return {
          termId,
          subject,
          predicate,
          object,
          ...pro,
          counterHolders: counter.holders,
          counterShares: counter.shares,
          counterMarketCap: counter.marketCap,
          counterSharePrice: counter.sharePrice,
        };
      })
      .filter((t): t is TripleSearchResult => t !== null);
  } catch {
    return [];
  }
}
