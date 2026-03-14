import { keccak256, toHex } from "viem";

export type TermRef =
  | {
      type: "atom";
      atomKey: string;
      label: string;
    }
  | {
      type: "triple";
      tripleKey: string;
      label?: string;
    };

export type TermRefId = `atom:${string}` | `triple:${string}`;

export type NestedEdgeKind = "relation" | "meta" | "conditional" | "modifier";
export type NestedEdgeOrigin = "agent" | "user";

export type NestedEdge = {
  kind: NestedEdgeKind;
  origin: NestedEdgeOrigin;
  predicate: string;
  subject: TermRef;
  object: TermRef;
  stableKey: string;
};

export function normalizeKeyPart(s: string): string {
  return (s ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function keccakText(input: string): string {
  return keccak256(toHex(input));
}

export function atomKeyFromLabel(label: string): string {
  return keccakText(`atom:${normalizeKeyPart(label)}`);
}

export function termRefToId(ref: TermRef): TermRefId {
  if (ref.type === "atom") {
    return `atom:${ref.atomKey}`;
  }
  return `triple:${ref.tripleKey}`;
}

export function stableKeyFromTriple(triple: {
  subject: TermRef;
  predicate: TermRef;
  object: TermRef;
}): string {
  const s = termRefToId(triple.subject);
  const p = termRefToId(triple.predicate);
  const o = termRefToId(triple.object);
  return keccakText(`triple:${s}|${p}|${o}`);
}

export function stableKeyFromEdge(params: {
  from: TermRef;
  predicate: TermRef;
  to: TermRef;
}): string {
  const s = termRefToId(params.from);
  const p = termRefToId(params.predicate);
  const o = termRefToId(params.to);
  return keccakText(`edge:${s}|${p}|${o}`);
}
