import { NextResponse } from "next/server";
import { globalSearch } from "@0xintuition/sdk";

import { ensureIntuitionGraphql, intuitionGraphqlUrl } from "@/lib/intuition";
import { parseVaultMetrics } from "@/lib/intuition/metrics";
import type { TripleSuggestion } from "@/lib/intuition/types";
import {
  graphqlAtomToSuggestion as sharedAtomToSuggestion,
  graphqlTripleToSuggestion as sharedTripleToSuggestion,
} from "@/lib/intuition/search";
import {
  type GraphqlAtom,
  type GraphqlTriple,
  TRIPLE_QUERY,
  fetchAtomsByWhere,
  fetchSemanticAtoms,
} from "@/lib/intuition/graphql-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Suggestion = AtomSuggestion from @/lib/intuition/types (re-aliased for local use)
type Suggestion = {
  id: string;
  label: string;
  source: "global" | "semantic" | "graphql";
  marketCap?: number | null;
  holders?: number | null;
  shares?: number | null;
  sharePrice?: number | null;
  tripleCount?: number | null;
};

type SearchPayload = {
  query?: string;
  limit?: number;
  kind?: "atom" | "triple";
  sLabel?: string;
  pLabel?: string;
  oLabel?: string;
};

const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function pickGlobalLabel(atom: {
  label?: string | null;
  value?: {
    text_object?: { data: string | null } | null;
    json_object?: { name?: unknown } | null;
    thing?: { name?: string | null } | null;
    person?: { name?: string | null } | null;
    organization?: { name?: string | null } | null;
  } | null;
}): string | null {
  if (atom.label) return atom.label;
  const text = atom.value?.text_object?.data ?? null;
  if (text) return text;
  // json_object.name comes from SemanticSearchDocument (data(path:"name"))
  const jsonName = atom.value?.json_object?.name;
  if (typeof jsonName === "string" && jsonName.trim()) return jsonName.trim();
  const thing = atom.value?.thing?.name ?? null;
  if (thing) return thing;
  const person = atom.value?.person?.name ?? null;
  if (person) return person;
  const org = atom.value?.organization?.name ?? null;
  if (org) return org;
  return null;
}

function mergeSuggestion(existing: Suggestion, incoming: Suggestion): Suggestion {
  const incomingLabel = incoming.label?.trim();
  const shouldReplaceLabel = Boolean(incomingLabel) &&
    (!existing.label ||
      existing.label === "—" ||
      (existing.label === existing.id && incomingLabel !== existing.id));

  return {
    ...existing,
    label: shouldReplaceLabel ? incomingLabel : existing.label,
    marketCap: existing.marketCap ?? incoming.marketCap ?? null,
    holders: existing.holders ?? incoming.holders ?? null,
    shares: existing.shares ?? incoming.shares ?? null,
    tripleCount: existing.tripleCount ?? incoming.tripleCount ?? null,
  };
}

function mergeSuggestions(...groups: Suggestion[][]): Suggestion[] {
  const merged: Suggestion[] = [];
  const byId = new Map<string, Suggestion>();

  for (const group of groups) {
    for (const item of group) {
      const existing = byId.get(item.id);
      if (!existing) {
        byId.set(item.id, item);
        merged.push(item);
        continue;
      }
      const next = mergeSuggestion(existing, item);
      byId.set(item.id, next);
      const idx = merged.findIndex((entry) => entry.id === item.id);
      if (idx >= 0) merged[idx] = next;
    }
  }

  return merged;
}

async function fetchGraphqlTriples(
  sLabel: string,
  pLabel: string,
  oLabel: string,
  limit: number,
): Promise<GraphqlTriple[]> {
  const conditions: Record<string, unknown>[] = [];
  if (sLabel) conditions.push({ subject: { label: { _ilike: `%${sLabel}%` } } });
  if (pLabel) conditions.push({ predicate: { label: { _ilike: `%${pLabel}%` } } });
  if (oLabel) conditions.push({ object: { label: { _ilike: `%${oLabel}%` } } });

  if (conditions.length === 0) return [];

  try {
    const res = await fetch(intuitionGraphqlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: TRIPLE_QUERY,
        variables: {
          where: conditions.length === 1 ? conditions[0] : { _and: conditions },
          limit,
        },
      }),
      cache: "no-store",
    });

    if (!res.ok) return [];
    const payload = await res.json();
    return Array.isArray(payload?.data?.triples) ? (payload.data.triples as GraphqlTriple[]) : [];
  } catch {
    return [];
  }
}

// Delegate to shared mappers from lib/intuition/search
function graphqlTripleToSuggestion(triple: GraphqlTriple): TripleSuggestion | null {
  return sharedTripleToSuggestion(triple);
}

function graphqlAtomToSuggestion(atom: GraphqlAtom, source: "graphql" | "semantic"): Suggestion | null {
  return sharedAtomToSuggestion(atom, source);
}

function mergeTripleSuggestions(...groups: TripleSuggestion[][]): TripleSuggestion[] {
  const merged: TripleSuggestion[] = [];
  const byId = new Map<string, TripleSuggestion>();

  for (const group of groups) {
    for (const item of group) {
      const existing = byId.get(item.id);
      if (!existing) {
        byId.set(item.id, item);
        merged.push(item);
        continue;
      }
      const next: TripleSuggestion = {
        ...existing,
        subject: existing.subject || item.subject,
        predicate: existing.predicate || item.predicate,
        object: existing.object || item.object,
        subjectId: existing.subjectId ?? item.subjectId,
        predicateId: existing.predicateId ?? item.predicateId,
        objectId: existing.objectId ?? item.objectId,
        marketCap: existing.marketCap ?? item.marketCap,
        holders: existing.holders ?? item.holders,
        shares: existing.shares ?? item.shares,
        sharePrice: existing.sharePrice ?? item.sharePrice,
        counterMarketCap: existing.counterMarketCap ?? item.counterMarketCap,
        counterHolders: existing.counterHolders ?? item.counterHolders,
        counterShares: existing.counterShares ?? item.counterShares,
        counterSharePrice: existing.counterSharePrice ?? item.counterSharePrice,
      };
      byId.set(item.id, next);
      const idx = merged.findIndex((entry) => entry.id === item.id);
      if (idx >= 0) merged[idx] = next;
    }
  }

  return merged;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as SearchPayload | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ suggestions: [] });
  }

  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit)
      ? clamp(Math.floor(body.limit), 1, MAX_LIMIT)
      : DEFAULT_LIMIT;

  try {
    ensureIntuitionGraphql();

    const kind = body.kind ?? "atom";

    if (kind === "triple") {
      const sLabel = typeof body.sLabel === "string" ? body.sLabel.trim() : "";
      const pLabel = typeof body.pLabel === "string" ? body.pLabel.trim() : "";
      const oLabel = typeof body.oLabel === "string" ? body.oLabel.trim() : "";

      const [globalResult, graphqlTriples] = await Promise.all([
        globalSearch(query, {
          atomsLimit: 0,
          accountsLimit: 0,
          triplesLimit: limit,
          collectionsLimit: 0,
        }),
        (sLabel || pLabel || oLabel)
          ? fetchGraphqlTriples(sLabel, pLabel, oLabel, limit)
          : Promise.resolve([]),
      ]);

      const globalTriples: TripleSuggestion[] = (globalResult?.triples ?? [])
        .map((triple): TripleSuggestion | null => {
          const pro = parseVaultMetrics(triple.term?.vaults?.[0]);
          const counter = parseVaultMetrics(triple.counter_term?.vaults?.[0]);

          const id = triple.term_id;
          const subject = triple.subject?.label ?? "";
          const predicate = triple.predicate?.label ?? "";
          const object = triple.object?.label ?? "";
          if (!id || !subject || !predicate || !object) return null;

          return {
            id,
            subject,
            predicate,
            object,
            subjectId: triple.subject?.term_id ?? null,
            predicateId: triple.predicate?.term_id ?? null,
            objectId: triple.object?.term_id ?? null,
            source: "global" as const,
            ...pro,
            counterHolders: counter.holders,
            counterShares: counter.shares,
            counterMarketCap: counter.marketCap,
            counterSharePrice: counter.sharePrice,
          };
        })
        .filter((item): item is TripleSuggestion => item !== null);

      const graphqlSuggs: TripleSuggestion[] = graphqlTriples
        .map(graphqlTripleToSuggestion)
        .filter((item): item is TripleSuggestion => item !== null);

      const triples = mergeTripleSuggestions(graphqlSuggs, globalTriples);
      return NextResponse.json({ triples });
    }

    const [globalResult, graphqlAtoms, semanticAtomResults] = await Promise.all([
      globalSearch(query, {
        atomsLimit: limit,
        accountsLimit: 0,
        triplesLimit: 0,
        collectionsLimit: 0,
      }),
      fetchAtomsByWhere({ label: { _ilike: `%${query}%` } }, limit),
      fetchSemanticAtoms(query, limit).catch((err: unknown) => {
        console.error("[intuition/search] semantic search failed:", err);
        return [] as GraphqlAtom[];
      }),
    ]);

    const globalAtoms: Suggestion[] = (globalResult?.atoms ?? []).flatMap((atom: { term_id: string; label?: string | null; value?: { text_object?: { data: string | null } | null; json_object?: { name?: unknown } | null; thing?: { name?: string | null } | null; person?: { name?: string | null } | null; organization?: { name?: string | null } | null } | null }) => {
      const label = pickGlobalLabel(atom);
      if (!label || label.startsWith("0x")) return [];
      return [{ id: atom.term_id, label, source: "global" as const }];
    });

    const semanticSuggs: Suggestion[] = semanticAtomResults
      .map((a: GraphqlAtom) => graphqlAtomToSuggestion(a, "semantic"))
      .filter((s): s is Suggestion => s !== null && !s.label.startsWith("0x"));

    const graphqlSuggs: Suggestion[] = graphqlAtoms
      .map((a: GraphqlAtom) => graphqlAtomToSuggestion(a, "graphql"))
      .filter((s): s is Suggestion => s !== null);

    const suggestions = mergeSuggestions(graphqlSuggs, globalAtoms, semanticSuggs);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json(
      { error: "Intuition search failed.", suggestions: [] },
      { status: 502 }
    );
  }
}
