import { depositToTripleMin } from "@/lib/intuition/intuitionDeposit";
import { labels } from "@/lib/vocabulary";

import type { PublishContext } from "./types";
import { PublishPipelineError } from "./errors";
import { sdkWriteConfig } from "./config";

export async function depositOnExistingTriples(params: {
  tripleTermIds: string[];
  ctx: PublishContext;
  minDeposit: bigint | null;
}): Promise<{ txHash: string }> {
  const { tripleTermIds, ctx, minDeposit } = params;

  const uniqueTermIds = Array.from(new Set(tripleTermIds.map((id) => id.trim()).filter(Boolean)));

  const txHashes: string[] = [];

  try {
    for (const termId of uniqueTermIds) {
      const outcome = await depositToTripleMin({
        config: sdkWriteConfig(ctx.writeConfig),
        termId,
        amount: minDeposit ?? undefined,
      });

      if (!outcome.ok) {
        throw new PublishPipelineError("deposit_failed", outcome.error);
      }

      txHashes.push(outcome.txHash);
    }
  } catch (error) {
    if (error instanceof PublishPipelineError) throw error;
    throw new PublishPipelineError("deposit_failed", labels.errorDepositFailed);
  }

  return { txHash: txHashes[txHashes.length - 1] ?? "0x0" };
}
