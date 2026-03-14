import "server-only";

import { getTripleDetails } from "@0xintuition/sdk";
import { parseVaultMetrics } from "@/lib/intuition/metrics";
import { asNumber } from "@/lib/format/asNumber";

export type IntuitionAtom = {
  term_id: string;
  label?: string | null;
  data?: string | null;
};

type TripleDetails = {
  term_id?: string | null;
  subject_id?: string | null;
  predicate_id?: string | null;
  object_id?: string | null;
  counter_term_id?: string | null;
  subject?: IntuitionAtom | null;
  predicate?: IntuitionAtom | null;
  object?: IntuitionAtom | null;
  term?: {
    vaults?: Array<{
      total_shares?: string | number | null;
      current_share_price?: string | number | null;
      market_cap?: string | number | null;
      position_count?: string | number | null;
      allPositions?: {
        aggregate?: { count?: string | number | null } | null;
      } | null;
    }> | null;
  } | null;
};

export type ResolvedTripleShape = {
  termId: string;
  subject: string;
  predicate: string;
  object: string;
  counterTermId: string | null;
  marketCap: number | null;
  holders: number | null;
  shares: number | null;
};

export type ResolvedAtomLabel = {
  label: string;
  nestedTriple: ResolvedTripleShape | null;
};

function atomLabel(atom: IntuitionAtom | null | undefined): string {
  return atom?.label || atom?.data || "Unknown";
}

export function mapTripleShape(details: TripleDetails): ResolvedTripleShape {
  const vault = details.term?.vaults?.[0];
  const metrics = parseVaultMetrics(vault);
  const holdersOverride = asNumber(
    vault?.allPositions?.aggregate?.count ?? null,
  );
  return {
    termId: String(details.term_id ?? ""),
    subject: atomLabel(details.subject),
    predicate: atomLabel(details.predicate),
    object: atomLabel(details.object),
    counterTermId: details.counter_term_id ?? null,
    marketCap: metrics.marketCap,
    holders: holdersOverride ?? metrics.holders,
    shares: metrics.shares,
  };
}

export async function resolveAtomLabel(
  atom: IntuitionAtom | null | undefined,
  fallbackTermId?: string | null,
): Promise<ResolvedAtomLabel> {
  if (atom?.label) return { label: atom.label, nestedTriple: null };

  const candidateIds = [
    ...new Set(
      [atom?.data, atom?.term_id, fallbackTermId].filter(Boolean) as string[],
    ),
  ];

  for (const id of candidateIds) {
    try {
      const nested = await getTripleDetails(String(id));
      if (nested) {
        const shape = mapTripleShape(nested as TripleDetails);
        const label = `${shape.subject} · ${shape.predicate} · ${shape.object}`;
        return { label, nestedTriple: shape };
      }
    } catch {

    }
  }

  const fallback = atom?.data ?? atom?.term_id;
  return {
    label: fallback ? String(fallback) : "Unknown",
    nestedTriple: null,
  };
}
