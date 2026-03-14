import { normalizeLabelForChain } from "@/lib/format/normalizeLabel";
import { conceptKey } from "@/lib/format/conceptKey";
import type { OnchainWriteConfig } from "./types";

export function sdkWriteConfig(wc: OnchainWriteConfig) {
  return { walletClient: wc.walletClient, publicClient: wc.publicClient, address: wc.multivaultAddress };
}

export function sdkReadConfig(wc: OnchainWriteConfig) {
  return { address: wc.multivaultAddress, publicClient: wc.publicClient };
}

export const normalizeText = normalizeLabelForChain;

export const atomKey = conceptKey;

export function normalizeAtomLabel(text: string): string {
  return normalizeLabelForChain(text)
    .split(/\s+/)
    .map((w) => /^[A-Z]{2,5}$/.test(w) ? w : w.toLowerCase())
    .join(" ");
}
