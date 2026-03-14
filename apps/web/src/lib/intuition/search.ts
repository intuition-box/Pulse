import type { AtomCandidate } from "@db/agents/search/types";
import type { TripleResult, AtomSuggestion, TripleSuggestion } from "./types";
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

export async function searchAtomsServer(query: string, limit: number): Promise<AtomCandidate[]> {
  const [exact, fuzzy, semantic] = await Promise.all([
    fetchExactAtoms(query),
    fetchFuzzyAtoms(query, limit),
    fetchSemanticAtomsAsCandidate(query, limit),
  ]);

  const byId = new Map<string, AtomCandidate>();
  for (const c of [...exact, ...fuzzy, ...semantic]) {
    if (!byId.has(c.termId)) {
      byId.set(c.termId, c);
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
