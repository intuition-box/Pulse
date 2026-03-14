import { formatEther } from "viem";
import { resolveNestedRefLabel, type NestedTermRef } from "../../extraction";

export type AtomInfo = {
  label: string;
  isExisting: boolean;
  matchedLabel: string | null;
};

export type HoverTerms = {
  sText: string;
  pText: string;
  oText: string;
  sentenceText: string;
  claimText: string;

  modifierTexts?: string[];
};

export type ViewState = "preview" | "publishing" | "success" | "error";

export type Check = { ok: boolean; label: string; okLabel: string };

export function isCtaDisabled(approvedCount: number, hasMain: boolean, checks: Check[]): boolean {
  return approvedCount === 0 || !hasMain || checks.some((c) => !c.ok);
}

export function formatCost(wei: bigint): string {
  const num = parseFloat(formatEther(wei));
  if (num === 0) return "0";
  if (num < 0.0001) return "< 0.0001";
  return num.toFixed(4).replace(/\.?0+$/, "");
}

export function renderNestedRef(ref: NestedTermRef, refLabels: Map<string, string>): string {
  return resolveNestedRefLabel(ref, refLabels);
}
