import "server-only";

import { intuitionGraphqlUrl } from "./intuition";
import { parseVaultMetrics } from "./metrics";
import type { VaultMetrics } from "./types";
import type { GraphqlTriple } from "./graphql-queries";

const TRIPLE_BY_IDS_QUERY = `
  query TriplesByTermIds($where: triples_bool_exp, $limit: Int) {
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

export type TripleVaultMetrics = {
  support: VaultMetrics;
  oppose: VaultMetrics;
};

export async function getTripleMetricsByIds(
  tripleTermIds: string[],
): Promise<Record<string, TripleVaultMetrics>> {
  if (tripleTermIds.length === 0) return {};

  const unique = [...new Set(tripleTermIds)];

  try {
    const res = await fetch(intuitionGraphqlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: TRIPLE_BY_IDS_QUERY,
        variables: {
          where: { term_id: { _in: unique } },
          limit: unique.length,
        },
      }),
      cache: "no-store",
    });

    if (!res.ok) return {};

    const payload = await res.json();
    const triples: GraphqlTriple[] = Array.isArray(payload?.data?.triples)
      ? payload.data.triples
      : [];

    const result: Record<string, TripleVaultMetrics> = {};
    for (const t of triples) {
      const id = String(t.term_id ?? "");
      if (!id) continue;
      result[id] = {
        support: parseVaultMetrics(t.term?.vaults?.[0]),
        oppose: parseVaultMetrics(t.counter_term?.vaults?.[0]),
      };
    }
    return result;
  } catch {
    return {};
  }
}
