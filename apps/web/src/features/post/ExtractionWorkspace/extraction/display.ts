import type { NestedTermRef } from "./types";

export function safeDisplayLabel(value: string | undefined | null, fallback = "[...]"): string {
  if (!value) return fallback;
  if (/^0x[0-9a-fA-F]{6,}$/i.test(value)) return fallback;
  return value;
}

export function resolveNestedRefLabel(
  ref: NestedTermRef,
  refLabels: Map<string, string>,
): string {
  if (ref.type === "atom") {
    const matched = refLabels.get(`atom:${ref.atomKey}`);
    return safeDisplayLabel(matched ?? ref.label, "[term]");
  }

  const mapResolved = refLabels.get(ref.tripleKey);
  if (mapResolved) return mapResolved;
  return safeDisplayLabel(ref.label, "[context]");
}

export function resolveTermRefLabel(
  ref: NestedTermRef | undefined,
  labelMap: Map<string, string>,
): string | null {
  if (!ref) return null;
  if (ref.type === "atom") {
    const matched = labelMap.get(`atom:${ref.atomKey}`);
    const safe = safeDisplayLabel(matched ?? ref.label, "");
    return safe || null;
  }

  const mapLabel = labelMap.get(ref.tripleKey);
  if (mapLabel) return mapLabel;
  const directLabel = safeDisplayLabel(ref.label, "");
  return directLabel || null;
}
