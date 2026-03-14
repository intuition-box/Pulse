import { normalize, tokenSimilarity } from "../utils/similarity.js";
import {
  applyCausalPreProcessing,
} from "./claimTransforms.js";
import { ensurePeriod } from "./text.js";
import { looksLikeProposition, parseCausal } from "./parse.js";
import { trackFallback } from "./fallbackTracker.js";
import { shouldSplitOnAnd } from "./andSplitClassifier.js";
import {
  CLAIM_DEDUP_THRESHOLD,
  TRIPLE_DEDUP_THRESHOLD,
  REPLY_PARENT_MATCH_THRESHOLD,
  RELATIVE_CLAUSE_RE,
} from "./rules/extractionRules.js";
import type { DecomposedClaim, FlatTriple } from "../types.js";
import type { ClaimPlan, GraphResult } from "./claimPlanner.js";

export function areTriplesDuplicate(a: FlatTriple, b: FlatTriple, threshold = TRIPLE_DEDUP_THRESHOLD): boolean {
  return (
    tokenSimilarity(normalize(a.subject), normalize(b.subject)) >= threshold &&
    tokenSimilarity(normalize(a.predicate), normalize(b.predicate)) >= threshold &&
    tokenSimilarity(normalize(a.object), normalize(b.object)) >= threshold
  );
}

function deduplicateClaimsStructured(claims: DecomposedClaim[], threshold = CLAIM_DEDUP_THRESHOLD): DecomposedClaim[] {
  const kept: DecomposedClaim[] = [];
  for (const claim of claims) {
    const text = claim.text.trim();
    if (!text) continue;
    const isDup = kept.some(
      (k) => tokenSimilarity(normalize(k.text), normalize(text)) >= threshold,
    );
    if (!isDup) kept.push(claim);
  }
  return kept;
}

export type CanonicalizePreGraphOptions = {
  parentClaimText?: string | null;
  sourceSentence?: string | null;
};

const REPLY_CAUSAL_COREF_RE = /^it\s+/i;

function extractMainSubject(text: string): string | null {
  const m = text.match(
    /^(.+?)\s+(?:is|are|was|were|has|have|had|can|will|shall|should|must|may|might|could|would|do|does|did)\b/i,
  );
  return m?.[1]?.trim() || null;
}

function trimRelativeClauseTail(claim: DecomposedClaim): DecomposedClaim {
  if (claim.role !== "MAIN") return claim;

  const text = claim.text.trim();
  const marker = RELATIVE_CLAUSE_RE.exec(text);
  if (!marker || marker.index <= 0) return claim;

  const before = text.slice(0, marker.index).trim().replace(/[,;:]\s*$/, "");
  if (!before) return claim;

  if (!looksLikeProposition(before)) return claim;

  trackFallback("trimRelativeClauseTail");
  return { ...claim, text: ensurePeriod(before) };
}

function projectReplyCausalToReasons(
  claims: DecomposedClaim[],
  parentClaimText?: string | null,
): DecomposedClaim[] {
  const parentNorm = normalize(parentClaimText ?? "");
  if (!parentNorm) return claims;

  return claims.map((claim) => {
    if (claim.role !== "MAIN") return claim;

    const causal = parseCausal(claim.text);
    if (!causal) return claim;

    const similarity = tokenSimilarity(normalize(causal.mainText), parentNorm);
    if (similarity < REPLY_PARENT_MATCH_THRESHOLD) return claim;

    let reason = causal.reasonText.trim();
    if (REPLY_CAUSAL_COREF_RE.test(reason)) {
      const subject = extractMainSubject(causal.mainText);
      if (subject) {
        reason = reason.replace(REPLY_CAUSAL_COREF_RE, `${subject} `);
      }
    }

    return { ...claim, text: ensurePeriod(reason) };
  });
}

function splitCompoundAndClaims(claims: DecomposedClaim[]): DecomposedClaim[] {
  let nextGroup = claims.length > 0 ? Math.max(...claims.map((c) => c.group)) + 1 : 0;
  const out: DecomposedClaim[] = [];

  for (const claim of claims) {
    if (claim.role !== "MAIN") {
      out.push(claim);
      continue;
    }

    const result = shouldSplitOnAnd(claim.text);
    if (result.action === "keep") {
      out.push(claim);
      continue;
    }

    trackFallback("andSplitClassifier:split");
    for (const part of result.parts) {
      out.push({
        ...claim,
        text: ensurePeriod(part),
        group: nextGroup++,
      });
    }
  }

  return out;
}

export function canonicalizePreGraph(
  claims: DecomposedClaim[],
  options: CanonicalizePreGraphOptions = {},
): DecomposedClaim[] {
  const afterDedup = deduplicateClaimsStructured(claims);
  const afterCausal = applyCausalPreProcessing(afterDedup);
  const afterAndSplit = splitCompoundAndClaims(afterCausal);
  const afterReplyProjection = projectReplyCausalToReasons(afterAndSplit, options.parentClaimText);
  const afterRelativeTrim = afterReplyProjection.map(trimRelativeClauseTail);
  return deduplicateClaimsStructured(afterRelativeTrim);
}

export function deduplicateGraphPlans(
  plans: ClaimPlan[],
  graphMap: Map<string, GraphResult | null>,
): ClaimPlan[] {
  const result: ClaimPlan[] = [];
  const seenCores: Array<{ core: FlatTriple; reasonCore?: FlatTriple; index: number; kind: ClaimPlan["kind"] }> = [];

  for (const plan of plans) {
    const graph = graphMap.get(plan.graphKeys[0]);
    if (!graph) { result.push(plan); continue; }
    const core = graph.core;

    const reasonCore = plan.kind === "causal" ? graphMap.get(plan.graphKeys[1])?.core : undefined;

    const existing = seenCores.find((s) => {
      const coreMatch = areTriplesDuplicate(s.core, core);
      if (!coreMatch) return false;
      if (s.reasonCore && reasonCore) {
        return areTriplesDuplicate(s.reasonCore, reasonCore);
      }
      if (s.reasonCore || reasonCore) return false;
      return true;
    });

    if (!existing) {
      seenCores.push({ core, reasonCore, index: result.length, kind: plan.kind });
      result.push(plan);
    } else if (plan.kind === "meta" && existing.kind !== "meta") {
      result[existing.index] = plan;
      existing.kind = "meta";
    }
  }
  return result;
}

function splitMultiMainGroups(
  claims: Array<{ claim: string; role: "MAIN" | "SUPPORTING"; group: number }>,
): void {
  if (claims.length === 0) return;
  let nextGroup = Math.max(...claims.map(c => c.group)) + 1;

  const groups = new Map<number, typeof claims>();
  for (const c of claims) {
    const g = groups.get(c.group) || [];
    g.push(c);
    groups.set(c.group, g);
  }

  for (const [, groupClaims] of groups) {
    const mains = groupClaims.filter(c => c.role === "MAIN");
    if (mains.length <= 1) continue;

    for (let i = 1; i < mains.length; i++) {
      mains[i].group = nextGroup++;
    }

    const supportings = groupClaims.filter(c => c.role === "SUPPORTING");
    for (const sup of supportings) {
      let bestMain = mains[0];
      let bestScore = -1;
      for (const m of mains) {
        const score = tokenSimilarity(normalize(sup.claim), normalize(m.claim));
        if (score > bestScore) {
          bestScore = score;
          bestMain = m;
        }
      }
      sup.group = bestMain.group;
    }
  }
}

function enforceOneMainPerGroup(
  claims: Array<{ claim: string; role: "MAIN" | "SUPPORTING"; group: number }>,
  referenceText: string,
): void {
  const groups = new Map<number, typeof claims>();
  for (const c of claims) {
    const g = groups.get(c.group) || [];
    g.push(c);
    groups.set(c.group, g);
  }

  const refNorm = normalize(referenceText);

  for (const [, groupClaims] of groups) {
    if (groupClaims.length === 0) continue;

    let best = groupClaims[0];
    let bestScore = -1;
    for (const c of groupClaims) {
      const score = tokenSimilarity(normalize(c.claim), refNorm);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    for (const c of groupClaims) {
      c.role = c === best ? "MAIN" : "SUPPORTING";
    }
  }
}

export function enforceRoles(
  claims: Array<{ claim: string; role: "MAIN" | "SUPPORTING"; group: number }>,
  referenceText: string,
): void {
  splitMultiMainGroups(claims);
  enforceOneMainPerGroup(claims, referenceText);
}
