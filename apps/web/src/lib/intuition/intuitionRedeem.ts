import type { WriteConfig } from "@0xintuition/sdk";
import { MultiVaultAbi } from "@0xintuition/sdk";
import type { Hex } from "viem";
import { getErrorMessage } from "@/lib/getErrorMessage";

const TERM_ID_RE = /^0x[a-fA-F0-9]{64}$/;

type TermId = `0x${string}`;
type TxHash = `0x${string}`;

function asTermId(value: unknown): TermId | null {
  const s = typeof value === "string" ? value.trim() : "";
  return TERM_ID_RE.test(s) ? (s as TermId) : null;
}

export type RedeemOutcome =
  | { ok: true; termId: TermId; txHash: TxHash; shares: bigint }
  | { ok: false; error: string };

export async function redeemFromTriple(params: {
  config: WriteConfig;
  termId: string;
  curveId?: bigint;
  shares: bigint;
  minAssets?: bigint;
}): Promise<RedeemOutcome> {
  try {
    const { config } = params;
    const termId = asTermId(params.termId);
    if (!termId) return { ok: false, error: "Invalid termId." };

    const account = config.walletClient.account?.address;
    if (!account) return { ok: false, error: "Wallet account not found." };

    if (params.shares <= 0n) return { ok: false, error: "Nothing to redeem." };

    const curveId = params.curveId ?? 1n;
    const minAssets = params.minAssets ?? 0n;

    const { request } = await config.publicClient.simulateContract({
      account: config.walletClient.account,
      address: config.address,
      abi: MultiVaultAbi,
      functionName: "redeem",
      args: [account, termId as Hex, curveId, params.shares, minAssets],
    });

    const txHash = (await config.walletClient.writeContract(request)) as TxHash;
    const receipt = await config.publicClient.waitForTransactionReceipt({ hash: txHash as Hex });
    if (receipt.status !== "success") {
      return { ok: false, error: "Redeem transaction failed or reverted." };
    }

    return { ok: true, termId, txHash, shares: params.shares };
  } catch (err: unknown) {
    return { ok: false, error: getErrorMessage(err, String(err)) };
  }
}

export async function queryMaxRedeem(params: {
  config: WriteConfig;
  termId: string;
  curveId?: bigint;
}): Promise<bigint> {
  const termId = asTermId(params.termId);
  if (!termId) return 0n;

  const account = params.config.walletClient.account?.address;
  if (!account) return 0n;

  const curveId = params.curveId ?? 1n;

  const result = await params.config.publicClient.readContract({
    address: params.config.address,
    abi: MultiVaultAbi,
    functionName: "maxRedeem",
    args: [account, termId as Hex, curveId],
  });

  return result as bigint;
}
