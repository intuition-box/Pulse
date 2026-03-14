import { normalizeLabelForChain } from "./normalizeLabel";

export function makeLabelKey(s: string, p: string, o: string): string {
  const norm = (t: string) => normalizeLabelForChain(t).toLowerCase();
  return `${norm(s)}|${norm(p)}|${norm(o)}`;
}
