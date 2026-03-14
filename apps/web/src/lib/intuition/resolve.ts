import "server-only";

import { createPublicClient, http, type Address } from "viem";
import { findTripleIds, getMultiVaultAddressFromChainId } from "@0xintuition/sdk";
import { multiVaultMultiCallIntuitionConfigs } from "@0xintuition/protocol";

import { intuitionTestnet } from "@/lib/chain";
import { ensureIntuitionGraphql, intuitionGraphqlUrl } from "@/lib/intuition";
import { fetchAtomsByWhere } from "@/lib/intuition/graphql-queries";
import { makeTripleKey } from "@/lib/format/makeTripleKey";
import { makeLabelKey } from "@/lib/format/makeLabelKey";
import { escapeLike } from "@/lib/format/escapeLike";
import { normalizeLabelForChain } from "@/lib/format/normalizeLabel";

export async function readMultivaultConfig(): Promise<{
  minDeposit: string;
  tripleCost: string;
  atomCost: string;
}> {
  const publicClient = createPublicClient({
    chain: intuitionTestnet,
    transport: http(),
  });

  const multivaultAddress = getMultiVaultAddressFromChainId(intuitionTestnet.id) as Address;
  const config = await multiVaultMultiCallIntuitionConfigs({
    address: multivaultAddress,
    publicClient,
  });

  return {
    minDeposit: config.min_deposit,
    tripleCost: config.triple_cost,
    atomCost: config.atom_cost,
  };
}

export async function resolveAtomIds(
  labels: string[],
): Promise<Array<{ inputLabel: string; termId: string; canonicalLabel: string }>> {
  const deduped = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
  if (deduped.length === 0) return [];

  ensureIntuitionGraphql();

  const results = await Promise.all(
    deduped.map(async (label) => {
      const normalized = normalizeLabelForChain(label);
      const atoms = await fetchAtomsByWhere(
        { label: { _ilike: escapeLike(normalized) } },
        20,
      );
      const best = atoms[0];
      if (!best?.term_id) return null;
      return {
        inputLabel: label,
        termId: String(best.term_id),
        canonicalLabel: best.label ?? label,
      };
    }),
  );

  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

export async function resolveAtomLabelsById(
  termIds: string[],
): Promise<Array<{ termId: string; canonicalLabel: string }>> {
  const deduped = [...new Set(termIds.filter(Boolean))];
  if (deduped.length === 0) return [];

  ensureIntuitionGraphql();

  const atoms = await fetchAtomsByWhere(
    { term_id: { _in: deduped } },
    deduped.length,
  );

  return atoms
    .filter((a) => a.term_id && a.label)
    .map((a) => ({ termId: String(a.term_id), canonicalLabel: a.label! }));
}

export async function resolveTripleIds(
  address: string,
  combinations: Array<[string, string, string]>,
): Promise<Record<string, string | null>> {
  const seen = new Map<string, [string, string, string]>();
  for (const combo of combinations) {
    const key = makeTripleKey(combo[0], combo[1], combo[2]);
    if (!seen.has(key)) {
      seen.set(key, combo);
    }
  }

  const deduped = Array.from(seen.values());
  const allKeys = Array.from(seen.keys());

  const result: Record<string, string | null> = {};
  for (const key of allKeys) {
    result[key] = null;
  }

  if (deduped.length === 0) return result;

  ensureIntuitionGraphql();
  const found = await findTripleIds(address as Address, deduped);

  for (const triple of found) {
    if (triple.term_id) {
      const key = makeTripleKey(triple.subject_id, triple.predicate_id, triple.object_id);
      result[key] = triple.term_id;
    }
  }

  return result;
}

const TRIPLES_BY_LABELS_QUERY = `
  query FindTriplesByLabels($where: triples_bool_exp!, $limit: Int!) {
    triples(where: $where, limit: $limit, order_by: { created_at: asc }) {
      term_id
      subject { term_id label }
      predicate { term_id label }
      object { term_id label }
      term { vaults(where: { curve_id: { _eq: "1" } }) { position_count } }
    }
  }
`;

type LabelCombo = { s: string; p: string; o: string };

type TripleByLabelResult = {
  term_id?: string | null;
  subject?: { term_id?: string | null; label?: string | null } | null;
  predicate?: { term_id?: string | null; label?: string | null } | null;
  object?: { term_id?: string | null; label?: string | null } | null;
  term?: {
    vaults?: Array<{ position_count?: string | number | null }> | null;
  } | null;
};

export type TripleMatchInfo = {
  tripleTermId: string;
  subjectAtomId: string;
  predicateAtomId: string;
  objectAtomId: string;
  sLabel: string;
  pLabel: string;
  oLabel: string;
};

export async function resolveTripleIdsByLabels(
  labelCombos: LabelCombo[],
): Promise<Record<string, TripleMatchInfo | null>> {
  const seen = new Map<string, LabelCombo>();
  for (const combo of labelCombos) {
    const key = makeLabelKey(combo.s, combo.p, combo.o);
    if (!seen.has(key)) seen.set(key, combo);
  }

  const result: Record<string, TripleMatchInfo | null> = {};
  for (const key of seen.keys()) result[key] = null;
  if (seen.size === 0) return result;

  ensureIntuitionGraphql();

  await Promise.all(
    Array.from(seen.entries()).map(async ([key, combo]) => {
      const where = {
        _and: [
          { subject: { label: { _ilike: escapeLike(normalizeLabelForChain(combo.s)) } } },
          { predicate: { label: { _ilike: escapeLike(normalizeLabelForChain(combo.p)) } } },
          { object: { label: { _ilike: escapeLike(normalizeLabelForChain(combo.o)) } } },
        ],
      };

      try {
        const res = await fetch(intuitionGraphqlUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: TRIPLES_BY_LABELS_QUERY,
            variables: { where, limit: 5 },
          }),
          cache: "no-store",
        });
        if (!res.ok) return;
        const payload = await res.json();
        const triples = Array.isArray(payload?.data?.triples)
          ? (payload.data.triples as TripleByLabelResult[])
          : [];

        let best: { triple: TripleByLabelResult; positionCount: number } | null = null;
        for (const triple of triples) {
          if (!triple.term_id) continue;
          if (!triple.subject?.term_id || !triple.predicate?.term_id || !triple.object?.term_id) continue;
          const pc = Number(triple.term?.vaults?.[0]?.position_count ?? 0);
          if (!best || pc > best.positionCount) {
            best = { triple, positionCount: pc };
          }
        }
        if (best) {
          const t = best.triple;
          result[key] = {
            tripleTermId: t.term_id!,
            subjectAtomId: t.subject!.term_id!,
            predicateAtomId: t.predicate!.term_id!,
            objectAtomId: t.object!.term_id!,
            sLabel: t.subject!.label ?? combo.s,
            pLabel: t.predicate!.label ?? combo.p,
            oLabel: t.object!.label ?? combo.o,
          };
        }
      } catch {
      }
    }),
  );

  return result;
}
