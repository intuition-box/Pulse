

import type { LanguageModel } from "ai";
import type { ExtractionResult, ExtractionOptions } from "../types.js";
import { retryWithBackoff } from "../utils/concurrency.js";

export type StanceDeps = {
  runStanceVerification: (model: LanguageModel, payload: string) => Promise<{ verifications: Array<{ stableKey: string; isRelevant: boolean; suggestedStance: string; reason: string }> }>;
  getGroqModel: () => LanguageModel;
};

const MAX_STANCE_CLAIMS = 100;

export async function runStanceStage(
  perSegment: ExtractionResult["perSegment"],
  parentContext: string,
  userStance: ExtractionOptions["userStance"],
  deps: StanceDeps,
): Promise<{ llmCalls: number }> {
  let llmCalls = 0;

  if (!parentContext || !userStance) return { llmCalls };

  const seenKeys = new Set<string>();
  const allClaims: Array<{ stableKey: string; text: string; triple: string }> = [];
  for (const seg of perSegment) {
    for (const c of seg.claims) {
      if (!c.triple) continue;
      if (seenKeys.has(c.triple.stableKey)) continue;
      seenKeys.add(c.triple.stableKey);
      allClaims.push({
        stableKey: c.triple.stableKey,
        text: c.claim,
        triple: `${c.triple.subject} | ${c.triple.predicate} | ${c.triple.object}`,
      });
    }
  }

  if (allClaims.length > 0 && allClaims.length <= MAX_STANCE_CLAIMS) {
    const stanceInput = {
      parentClaim: parentContext,
      userStance,
      claims: allClaims,
    };

    try {
      llmCalls++;
      const stanceOut = await retryWithBackoff(() => deps.runStanceVerification(deps.getGroqModel(), JSON.stringify(stanceInput, null, 2)));

      const verificationMap = new Map(
        stanceOut.verifications.map((v) => [v.stableKey, v])
      );

      for (const seg of perSegment) {
        for (const c of seg.claims) {
          if (!c.triple) continue;
          const v = verificationMap.get(c.triple.stableKey);
          if (v) {
            c.isRelevant = v.isRelevant;
            c.suggestedStance = v.suggestedStance as "SUPPORTS" | "REFUTES";
            c.stanceAligned = v.isRelevant ? (v.suggestedStance === userStance) : false;
            c.stanceReason = v.reason;
          }
        }
      }
    } catch {

    }
  }

  return { llmCalls };
}
