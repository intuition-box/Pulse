

import type { NestedEdge, TermRef } from "../core.js";
import { atomKeyFromLabel, stableKeyFromEdge, stableKeyFromTriple } from "../core.js";
import type { FlatTriple } from "../types.js";
import { normalizeAtomValue } from "./text.js";
import { safeTrim } from "./text.js";

export function termAtom(value: string): TermRef {
  const label = normalizeAtomValue(value);
  return { type: "atom", atomKey: atomKeyFromLabel(label), label };
}

export function termTriple(t: FlatTriple & { stableKey: string }): TermRef {
  return {
    type: "triple",
    tripleKey: t.stableKey,
    label: `${t.subject} · ${t.predicate} · ${t.object}`,
  };
}

export function tripleKeyed(t: FlatTriple): FlatTriple & { stableKey: string } {
  const stableKey = stableKeyFromTriple({
    subject: termAtom(t.subject),
    predicate: termAtom(t.predicate),
    object: termAtom(t.object),
  });
  return { ...t, stableKey };
}

export function ensureEdgeKey(e: Omit<NestedEdge, "stableKey">): NestedEdge {
  const pred = safeTrim(e.predicate);
  if (!pred) {
    throw new Error(`[extract] NestedEdge missing predicate: ${JSON.stringify(e)}`);
  }
  if (!e.subject || !e.object) {
    throw new Error(`[extract] NestedEdge missing subject/object: ${JSON.stringify(e)}`);
  }

  return {
    ...e,
    stableKey: stableKeyFromEdge({
      from: e.subject,
      predicate: termAtom(pred),
      to: e.object,
    }),
  };
}

export function pushEdge(nested: NestedEdge[], existing: Set<string>, edge: Omit<NestedEdge, "stableKey">): string {
  const normalized = ensureEdgeKey(edge);
  if (!existing.has(normalized.stableKey)) {
    existing.add(normalized.stableKey);
    nested.push(normalized);
  }
  return normalized.stableKey;
}

