

export const safeTrim = (s: unknown) => (s ?? "").toString().trim();

export function stripOuterQuotes(s: string): string {
  return (s ?? "")
    .toString()
    .trim()
    .replace(/^[\s"'"\u201C\u2018]+/, "")
    .replace(/[\s"'"\u201D\u2019]+$/, "")
    .trim();
}

export function ensurePeriod(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return /[.!?]$/.test(t) ? t : t + ".";
}

export function normalizeAtomValue(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

export function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}
