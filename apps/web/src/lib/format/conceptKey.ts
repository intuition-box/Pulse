import { normalizeLabelForChain } from "./normalizeLabel";

export function conceptKey(text: string): string {
  return normalizeLabelForChain(text).toLowerCase();
}
