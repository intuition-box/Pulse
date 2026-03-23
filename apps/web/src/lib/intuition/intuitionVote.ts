import type { WriteConfig } from "@0xintuition/sdk";
import { calculateCounterTripleId } from "@0xintuition/sdk";
import type { Hex } from "viem";

import { depositToTripleMin, type DepositToTripleOutcome } from "./intuitionDeposit";
import { redeemFromTriple, type RedeemOutcome } from "./intuitionRedeem";

export type VoteDirection = "support" | "oppose";

export async function voteOnTriple(params: {
  config: WriteConfig;
  tripleTermId: string;
  counterTermId?: string | null;
  direction: VoteDirection;
  amount?: bigint;
  curveId?: bigint;
}): Promise<DepositToTripleOutcome> {
  /**
   * INTUITION.md specifies: depositTriple(uint256 tripleId, uint256 amount, bool isPositive)
   * (see INTUITION.md:1141). The installed @0xintuition/sdk does NOT expose depositTriple,
   * so we mirror the semantics by depositing to the counter-term when direction === "oppose".
   */
  const targetTermId =
    params.direction === "oppose"
      ? params.counterTermId ?? calculateCounterTripleId(params.tripleTermId as Hex)
      : params.tripleTermId;

  return depositToTripleMin({
    config: params.config,
    termId: targetTermId,
    amount: params.amount,
    curveId: params.curveId,
  });
}

export async function redeemVote(params: {
  config: WriteConfig;
  tripleTermId: string;
  counterTermId?: string | null;
  direction: VoteDirection;
  shares: bigint;
  curveId?: bigint;
}): Promise<RedeemOutcome> {
  const targetTermId =
    params.direction === "oppose"
      ? params.counterTermId ?? calculateCounterTripleId(params.tripleTermId as Hex)
      : params.tripleTermId;

  return redeemFromTriple({
    config: params.config,
    termId: targetTermId,
    shares: params.shares,
    curveId: params.curveId,
  });
}
