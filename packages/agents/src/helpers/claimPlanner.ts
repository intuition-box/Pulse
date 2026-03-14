import type { Causal, Conditional, DecomposedClaim, FlatTriple } from "../types.js";
import { parseMetaClaim, parseConditional, parseCausal } from "./parse.js";

export type GraphResult = {
  core: FlatTriple;
  modifiers: Array<{ prep: string; value: string }>;
};

export type ClaimPlanKind = "meta" | "conditional" | "causal" | "standard";
export type KindSource = "rule" | "agent" | "fallback";

export type ClaimPlan =
  | { kind: "meta"; claim: string; role: "MAIN" | "SUPPORTING"; group: number; meta: { source: string; verb: string; proposition: string }; graphKeys: string[]; kindSource: KindSource }
  | { kind: "conditional"; claim: string; role: "MAIN" | "SUPPORTING"; group: number; cond: Conditional; graphKeys: string[]; kindSource: KindSource }
  | { kind: "causal"; claim: string; role: "MAIN" | "SUPPORTING"; group: number; causal: Causal; graphKeys: string[]; kindSource: KindSource }
  | { kind: "standard"; claim: string; role: "MAIN" | "SUPPORTING"; group: number; graphKeys: string[]; kindSource: KindSource };

function resolveKind(
  claim: string,
): {
  kind: ClaimPlanKind;
  source: KindSource;
  meta?: { source: string; verb: string; proposition: string };
  cond?: Conditional;
  causal?: Causal;
} {
  const meta = parseMetaClaim(claim);
  if (meta) return { kind: "meta", source: "rule", meta };

  const cond = parseConditional(claim);
  if (cond) return { kind: "conditional", source: "rule", cond };

  const causal = parseCausal(claim);
  if (causal) return { kind: "causal", source: "rule", causal };

  return { kind: "standard", source: "fallback" };
}
export function buildClaimPlans(
  claims: DecomposedClaim[],
  sentenceContext: string,
  graphFromClaim: (claimText: string, sentenceContext: string) => Promise<GraphResult | null>,
): { plans: ClaimPlan[]; graphJobs: Map<string, Promise<GraphResult | null>> } {
  const plans: ClaimPlan[] = [];
  const graphJobs = new Map<string, Promise<GraphResult | null>>();

  for (const dc of claims) {
    const claim = dc.text;
    const resolved = resolveKind(claim);

    switch (resolved.kind) {
      case "meta": {
        const { meta } = resolved;
        const key = `meta:${claim}`;
        graphJobs.set(key, graphFromClaim(meta!.proposition, sentenceContext));
        plans.push({ kind: "meta", claim, role: dc.role, group: dc.group, meta: meta!, graphKeys: [key], kindSource: resolved.source });
        break;
      }
      case "conditional": {
        const { cond } = resolved;
        const mainKey = `cond-main:${claim}`;
        const condKey = `cond-sub:${claim}`;
        graphJobs.set(mainKey, graphFromClaim(cond!.mainText + ".", sentenceContext));
        graphJobs.set(condKey, graphFromClaim(cond!.condText + ".", sentenceContext));
        plans.push({ kind: "conditional", claim, role: dc.role, group: dc.group, cond: cond!, graphKeys: [mainKey, condKey], kindSource: resolved.source });
        break;
      }
      case "causal": {
        const { causal } = resolved;
        const mainKey = `causal-main:${claim}`;
        const reasonKey = `causal-reason:${claim}`;
        graphJobs.set(mainKey, graphFromClaim(causal!.mainText + ".", sentenceContext));
        graphJobs.set(reasonKey, graphFromClaim(causal!.reasonText + ".", sentenceContext));
        plans.push({ kind: "causal", claim, role: dc.role, group: dc.group, causal: causal!, graphKeys: [mainKey, reasonKey], kindSource: resolved.source });
        break;
      }
      default: {
        const key = `std:${claim}`;
        graphJobs.set(key, graphFromClaim(claim, sentenceContext));
        plans.push({ kind: "standard", claim, role: dc.role, group: dc.group, graphKeys: [key], kindSource: resolved.source });
        break;
      }
    }
  }

  return { plans, graphJobs };
}
