import { intuitionGraphqlUrl } from "./intuition";
import { parseVaultMetrics } from "./metrics";

export const ATOM_QUERY = `
  query FindAtoms($where: atoms_bool_exp, $limit: Int) {
    atoms(where: $where, limit: $limit, order_by: [{term_id: asc}]) {
      term_id
      label
      data
      as_subject_triples_aggregate { aggregate { count } }
      as_predicate_triples_aggregate { aggregate { count } }
      as_object_triples_aggregate { aggregate { count } }
      term {
        vaults(where: {curve_id: {_eq: "1"}}) {
          total_shares
          current_share_price
          market_cap
          position_count
          positions_aggregate {
            aggregate {
              count
              sum {
                shares
              }
            }
          }
        }
      }
    }
  }
`;

export const ATOM_SEMANTIC_QUERY = `
  query SemanticSearchAtoms($query: String!, $limit: Int) {
    search_term(args: {query: $query}, limit: $limit) {
      atom {
        term_id
        label
        data
        as_subject_triples_aggregate { aggregate { count } }
        as_predicate_triples_aggregate { aggregate { count } }
        as_object_triples_aggregate { aggregate { count } }
        term {
          vaults(where: {curve_id: {_eq: "1"}}) {
            total_shares
            current_share_price
            market_cap
            position_count
          }
        }
      }
    }
  }
`;

export const TRIPLE_QUERY = `
  query FindTriples($where: triples_bool_exp, $limit: Int) {
    triples(where: $where, limit: $limit) {
      term_id
      subject { term_id label }
      predicate { term_id label }
      object { term_id label }
      term {
        vaults(where: {curve_id: {_eq: "1"}}) {
          total_shares
          current_share_price
          market_cap
          position_count
        }
      }
      counter_term {
        vaults(where: {curve_id: {_eq: "1"}}) {
          total_shares
          current_share_price
          market_cap
          position_count
        }
      }
    }
  }
`;

type TripleAggregate = { aggregate?: { count?: string | number | null } | null } | null;

export type GraphqlAtom = {
  term_id?: string | null;
  label?: string | null;
  data?: string | null;
  as_subject_triples_aggregate?: TripleAggregate;
  as_predicate_triples_aggregate?: TripleAggregate;
  as_object_triples_aggregate?: TripleAggregate;
  term?: {
    vaults?: Array<{
      total_shares?: string | number | null;
      current_share_price?: string | number | null;
      market_cap?: string | number | null;
      position_count?: string | number | null;
      positions_aggregate?: {
        aggregate?: {
          count?: string | number | null;
          sum?: {
            shares?: string | number | null;
          } | null;
        } | null;
      } | null;
    }> | null;
  } | null;
};

export function parseTripleCount(atom: GraphqlAtom): number {
  const s = Number(atom.as_subject_triples_aggregate?.aggregate?.count ?? 0);
  const p = Number(atom.as_predicate_triples_aggregate?.aggregate?.count ?? 0);
  const o = Number(atom.as_object_triples_aggregate?.aggregate?.count ?? 0);
  return s + p + o;
}

export type GraphqlTriple = {
  term_id?: string | null;
  subject?: { term_id?: string | null; label?: string | null } | null;
  predicate?: { term_id?: string | null; label?: string | null } | null;
  object?: { term_id?: string | null; label?: string | null } | null;
  term?: {
    vaults?: Array<{
      total_shares?: string | number | null;
      current_share_price?: string | number | null;
      market_cap?: string | number | null;
      position_count?: string | number | null;
    }> | null;
  } | null;
  counter_term?: {
    vaults?: Array<{
      total_shares?: string | number | null;
      current_share_price?: string | number | null;
      market_cap?: string | number | null;
      position_count?: string | number | null;
    }> | null;
  } | null;
};

export async function fetchTriplesBySharedTopicAtoms(
  atomIds: string[],
  excludeTripleId: string,
  limit: number,
): Promise<GraphqlTriple[]> {
  if (!atomIds.length) return [];
  try {
    const orClauses = atomIds.flatMap((id) => [
      { subject_id: { _eq: id } },
      { object_id: { _eq: id } },
    ]);
    const res = await fetch(intuitionGraphqlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: TRIPLE_QUERY,
        variables: {
          where: {
            term_id: { _neq: excludeTripleId },
            _or: orClauses,
          },
          limit,
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const payload = await res.json();
    return Array.isArray(payload?.data?.triples)
      ? (payload.data.triples as GraphqlTriple[])
      : [];
  } catch {
    return [];
  }
}

export async function fetchAtomsByWhere(
  where: Record<string, unknown>,
  limit: number,
): Promise<GraphqlAtom[]> {
  try {
    const res = await fetch(intuitionGraphqlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: ATOM_QUERY,
        variables: { where, limit },
      }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const payload = await res.json();
    const atoms = Array.isArray(payload?.data?.atoms) ? (payload.data.atoms as GraphqlAtom[]) : [];

    atoms.sort((a, b) => {
      const mA = parseVaultMetrics(a.term?.vaults?.[0]);
      const mB = parseVaultMetrics(b.term?.vaults?.[0]);
      const pcA = mA.holders ?? 0;
      const pcB = mB.holders ?? 0;
      if (pcB !== pcA) return pcB - pcA;
      const mcA = mA.marketCap ?? 0;
      const mcB = mB.marketCap ?? 0;
      if (mcB !== mcA) return mcB - mcA;
      return (a.label ?? "").localeCompare(b.label ?? "");
    });

    return atoms;
  } catch {
    return [];
  }
}

export async function fetchSemanticAtoms(query: string, limit: number): Promise<GraphqlAtom[]> {
  try {
    const res = await fetch(intuitionGraphqlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: ATOM_SEMANTIC_QUERY,
        variables: { query, limit },
      }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const payload = await res.json();
    const terms = payload?.data?.search_term;
    if (!Array.isArray(terms)) return [];
    return terms
      .map((t: { atom?: GraphqlAtom | null }) => t.atom)
      .filter((a: GraphqlAtom | null | undefined): a is GraphqlAtom => a != null);
  } catch {
    return [];
  }
}
