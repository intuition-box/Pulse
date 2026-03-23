"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { getMultiVaultAddressFromChainId, calculateCounterTripleId } from "@0xintuition/sdk";

import { ThumbVote } from "./ThumbVote";
import { intuitionTestnet } from "@/lib/chain";
import { voteOnTriple, redeemVote } from "@/lib/intuition/intuitionVote";
import { queryMaxRedeem } from "@/lib/intuition/intuitionRedeem";
import { fetchJsonWithTimeout } from "@/lib/net/fetchWithTimeout";
import { parseTxError } from "@/lib/getErrorMessage";
import { useToast } from "@/components/Toast/ToastContext";
import type { SentimentData } from "@/hooks/useSentimentBatch";

/* ── Types ───────────────────────────────────────────────────────────── */

type FullVaultResponse = {
  vault: {
    for: { totalAssets: string; positionCount: number };
    against: { totalAssets: string; positionCount: number };
  };
  userPosition: {
    sharesFor: string;
    sharesAgainst: string;
    direction: "FOR" | "AGAINST" | null;
  } | null;
};

type ConnectedThumbVoteProps = {
  tripleTermId: string;
  counterTermId?: string | null;
  sentimentData?: SentimentData | null;
  size?: "sm" | "md";
  onVoteSuccess?: () => void;
};

/* ── Component ───────────────────────────────────────────────────────── */

export function ConnectedThumbVote({
  tripleTermId,
  counterTermId = null,
  sentimentData = null,
  size = "sm",
  onVoteSuccess,
}: ConnectedThumbVoteProps) {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const { addToast } = useToast();

  // Local state (from sentimentData or fallback fetch)
  const [forCount, setForCount] = useState(sentimentData?.forCount ?? 0);
  const [againstCount, setAgainstCount] = useState(sentimentData?.againstCount ?? 0);
  const [userDirection, setUserDirection] = useState<"support" | "oppose" | null>(sentimentData?.userDirection ?? null);
  const [busy, setBusy] = useState(false);
  const [busyDirection, setBusyDirection] = useState<"support" | "oppose" | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  // Cached minDeposit (lazy-loaded on first vote)
  const minDepositRef = useRef<bigint | null>(null);
  const prevAddressRef = useRef<string | undefined>(address);

  const correctChain = chainId === intuitionTestnet.id;

  // ── Sync from sentimentData props ──
  useEffect(() => {
    if (sentimentData) {
      setForCount(sentimentData.forCount);
      setAgainstCount(sentimentData.againstCount);
      setUserDirection(sentimentData.userDirection);
    }
  }, [sentimentData]);

  // ── Wallet change: reset direction immediately, then refetch if in fallback mode ──
  useEffect(() => {
    if (prevAddressRef.current !== address) {
      prevAddressRef.current = address;
      setUserDirection(null);
      if (!sentimentData) {
        fetchFallbackData();
      }
    }
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fallback fetch (when sentimentData not provided — e.g. Inspector) ──
  const fetchFallbackData = useCallback(async () => {
    setFallbackLoading(true);
    try {
      const url = address
        ? `/api/vaults/${tripleTermId}?address=${address}`
        : `/api/vaults/${tripleTermId}`;
      const data = await fetchJsonWithTimeout<FullVaultResponse>(url, { cache: "no-store" });

      setForCount(data.vault.for.positionCount);
      setAgainstCount(data.vault.against.positionCount);

      const pos = data.userPosition;
      if (pos) {
        const hasFor = BigInt(pos.sharesFor) > 0n;
        const hasAgainst = BigInt(pos.sharesAgainst) > 0n;
        if (hasFor) setUserDirection("support");
        else if (hasAgainst) setUserDirection("oppose");
        else setUserDirection(null);
      } else {
        setUserDirection(null);
      }
    } catch {
      // Keep previous values
    } finally {
      setFallbackLoading(false);
    }
  }, [tripleTermId, address]);

  // ── Initial fallback fetch ──
  useEffect(() => {
    if (!sentimentData) {
      fetchFallbackData();
    }
  }, [sentimentData, fetchFallbackData]);

  // ── Lazy-load minDeposit ──
  async function ensureMinDeposit(): Promise<bigint | null> {
    if (minDepositRef.current !== null) return minDepositRef.current;
    try {
      const config = await fetchJsonWithTimeout<{ minDeposit: string }>("/api/intuition/config");
      minDepositRef.current = BigInt(config.minDeposit);
      return minDepositRef.current;
    } catch {
      return null;
    }
  }

  // ── Vote handler (deposit or redeem toggle)
  async function handleVote(direction: "support" | "oppose") {
    if (!isConnected) {
      addToast("Connect wallet to vote", "info");
      return;
    }

    if (!walletClient || !publicClient) return;

    const isRedeem = userDirection === direction;

    setBusy(true);
    setBusyDirection(direction);

    // Switch chain if needed
    if (!correctChain) {
      try {
        await switchChainAsync({ chainId: intuitionTestnet.id });
      } catch {
        addToast("Failed to switch network", "error");
        setBusy(false);
        setBusyDirection(null);
        return;
      }
    }

    const addr = getMultiVaultAddressFromChainId(intuitionTestnet.id);
    const config = { walletClient, publicClient, address: addr };

    const prevFor = forCount;
    const prevAgainst = againstCount;
    const prevDirection = userDirection;

    if (isRedeem) {
      const targetTermId = direction === "support"
        ? tripleTermId
        : (counterTermId ?? calculateCounterTripleId(tripleTermId as `0x${string}`));
      const shares = await queryMaxRedeem({ config, termId: targetTermId, curveId: 1n });

      if (shares === 0n) {
        addToast("Nothing to withdraw", "info");
        setBusy(false);
        setBusyDirection(null);
        return;
      }

      if (direction === "support") setForCount((c) => Math.max(0, c - 1));
      else setAgainstCount((c) => Math.max(0, c - 1));
      setUserDirection(null);

      const result = await redeemVote({
        config,
        tripleTermId,
        counterTermId,
        direction,
        shares,
        curveId: 1n,
      });

      if (result.ok) {
        addToast("Position withdrawn", "success");
        onVoteSuccess?.();
      } else {
        setForCount(prevFor);
        setAgainstCount(prevAgainst);
        setUserDirection(prevDirection);
        const { short, isReject } = parseTxError(result.error ?? "Redeem failed");
        addToast(short, isReject ? "info" : "error");
      }
    } else {
      const minDeposit = await ensureMinDeposit();
      if (minDeposit === null) {
        addToast("Failed to load config", "error");
        setBusy(false);
        setBusyDirection(null);
        return;
      }

      if (direction === "support") setForCount((c) => c + 1);
      else setAgainstCount((c) => c + 1);
      setUserDirection(direction);

      const result = await voteOnTriple({
        config,
        tripleTermId,
        counterTermId,
        direction,
        amount: minDeposit,
        curveId: 1n,
      });

      if (result.ok) {
        onVoteSuccess?.();
      } else {
        setForCount(prevFor);
        setAgainstCount(prevAgainst);
        setUserDirection(prevDirection);
        const { short, isReject } = parseTxError(result.error ?? "Vote failed");
        addToast(short, isReject ? "info" : "error");
      }
    }

    setBusy(false);
    setBusyDirection(null);
  }

  return (
    <ThumbVote
      forCount={fallbackLoading ? 0 : forCount}
      againstCount={fallbackLoading ? 0 : againstCount}
      userDirection={userDirection}
      onVote={handleVote}
      busy={busy}
      busyDirection={busyDirection}
      disabled={fallbackLoading}
      size={size}
    />
  );
}
