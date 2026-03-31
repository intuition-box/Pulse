import { NextResponse } from "next/server";

import { fetchTripleDetailsBatch, fetchTriplesBySharedTopicAtoms } from "@/lib/intuition/graphql-queries";
import { resolveTripleDeep, toMatchedTree, type ResolvedTripleShape } from "@/lib/intuition/resolveTerm";
import { intuitionGraphqlUrl } from "@/lib/intuition/intuition";

const SEARCH_TRIPLE_QUERY = `
  query SearchTriples($query: String!, $limit: Int) {
    search_term(args: {query: $query}, limit: $limit) {
      atom {
        term_id
        label
        as_subject_triples_aggregate { aggregate { count } }
        as_predicate_triples_aggregate { aggregate { count } }
        as_object_triples_aggregate { aggregate { count } }
      }
      triple {
        term_id
        subject_id
        object_id
        subject { term_id label }
        predicate { term_id label }
        object { term_id label }
        term {
          vaults(where: {curve_id: {_eq: "1"}}) {
            total_shares
            current_share_price
            market_cap
            position_count
            allPositions: positions_aggregate { aggregate { count } }
          }
        }
      }
    }
  }
`;

type SearchTermResult = {
  atom?: { term_id?: string | null } | null;
  triple?: {
    term_id?: string | null;
    subject_id?: string | null;
    object_id?: string | null;
    subject?: { term_id?: string | null; label?: string | null } | null;
    predicate?: { term_id?: string | null; label?: string | null } | null;
    object?: { term_id?: string | null; label?: string | null } | null;
    term?: {
      vaults?: Array<{
        total_shares?: string | number | null;
        current_share_price?: string | number | null;
        market_cap?: string | number | null;
        position_count?: string | number | null;
        allPositions?: { aggregate?: { count?: string | number | null } | null } | null;
      }> | null;
    } | null;
  } | null;
};

export async function POST(request: Request) {
  try {
    const { query, limit = 20 } = (await request.json()) as { query: string; limit?: number };

    if (!query || typeof query !== "string") {
      return NextResponse.json({ trees: [] });
    }

    // Search candidates
    const res = await fetch(intuitionGraphqlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: SEARCH_TRIPLE_QUERY,
        variables: { query, limit },
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ trees: [] });
    }

    const payload = await res.json();
    const terms = payload?.data?.search_term;
    if (!Array.isArray(terms)) {
      return NextResponse.json({ trees: [] });
    }

    const tripleResults = (terms as SearchTermResult[])
      .map((t) => t.triple)
      .filter((t): t is NonNullable<typeof t> => t != null && t.term_id != null);

    if (tripleResults.length === 0) {
      return NextResponse.json({ trees: [] });
    }

    // Which S/O are themselves triples?
    const childIds = new Set<string>();
    for (const t of tripleResults) {
      if (t.subject_id) childIds.add(String(t.subject_id));
      if (t.object_id) childIds.add(String(t.object_id));
    }

    const nestedTripleIds = new Set<string>();
    if (childIds.size > 0) {
      const childBatch = await fetchTripleDetailsBatch([...childIds]);
      for (const child of childBatch) {
        if (child.term_id) nestedTripleIds.add(String(child.term_id));
      }
    }

    // Split flat vs nested
    const trees: Array<{ termId: string; tree: ReturnType<typeof toMatchedTree>; positionCount: number }> = [];
    const nestedTriples: typeof tripleResults = [];

    for (const t of tripleResults) {
      const sIsTriple = t.subject_id && nestedTripleIds.has(String(t.subject_id));
      const oIsTriple = t.object_id && nestedTripleIds.has(String(t.object_id));

      if (sIsTriple || oIsTriple) {
        nestedTriples.push(t);
      } else {
        trees.push({
          termId: String(t.term_id),
          tree: {
            subject: t.subject?.label || "Unknown",
            predicate: t.predicate?.label || "Unknown",
            object: t.object?.label || "Unknown",
          },
          positionCount: Number(t.term?.vaults?.[0]?.position_count ?? 0),
        });
      }
    }

    // Parent triples referencing flat results
    const flatTermIds = trees.map((t) => t.termId);
    if (flatTermIds.length > 0) {
      const parentTriples = await fetchTriplesBySharedTopicAtoms(flatTermIds, "", 20);
      const searchTermIds = new Set(tripleResults.map((t) => String(t.term_id)));
      for (const parent of parentTriples) {
        const pid = parent.term_id ? String(parent.term_id) : null;
        if (!pid || searchTermIds.has(pid)) continue; // skip if already in search results
        nestedTriples.push({
          term_id: pid,
          subject_id: parent.subject?.term_id ? String(parent.subject.term_id) : null,
          object_id: parent.object?.term_id ? String(parent.object.term_id) : null,
          subject: parent.subject,
          predicate: parent.predicate,
          object: parent.object,
          term: parent.term,
        });
      }
    }

    // Deep resolve nested
    if (nestedTriples.length > 0) {
      const termIds = nestedTriples.map((t) => String(t.term_id));
      const detailsBatch = await fetchTripleDetailsBatch(termIds);

      const deepResults = await Promise.all(
        detailsBatch.map(async (details) => {
          const termId = details.term_id ? String(details.term_id) : null;
          if (!termId) return null;

          const vault = details.term?.vaults?.[0];
          const positionCount = Number(vault?.position_count ?? 0);
          const nested = await resolveTripleDeep(details, 10);

          const shape: ResolvedTripleShape = {
            termId,
            subject: details.subject?.label || "Unknown",
            predicate: details.predicate?.label || "Unknown",
            object: details.object?.label || "Unknown",
            counterTermId: details.counter_term_id ? String(details.counter_term_id) : null,
            marketCap: null,
            holders: positionCount,
            shares: null,
            subjectNested: nested.subjectNested,
            objectNested: nested.objectNested,
          };

          return { termId, tree: toMatchedTree(shape), positionCount };
        }),
      );

      for (const r of deepResults) {
        if (r) trees.push(r);
      }
    }

    trees.sort((a, b) => b.positionCount - a.positionCount);

    return NextResponse.json({ trees });
  } catch {
    return NextResponse.json({ trees: [] });
  }
}
