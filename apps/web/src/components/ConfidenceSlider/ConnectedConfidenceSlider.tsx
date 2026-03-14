"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { getMultiVaultAddressFromChainId } from "@0xintuition/sdk";
import { formatEther, parseEther } from "viem";

import { ConfidenceSlider, type ConfidenceSliderResult } from "./ConfidenceSlider";
import { intuitionTestnet } from "@/lib/chain";
import { voteOnTriple } from "@/lib/intuition/intuitionVote";
import { fetchJsonWithTimeout } from "@/lib/net/fetchWithTimeout";

type ActionStatus = "idle" | "pending" | "success" | "error";

type VaultResponse = {
  userPosition: {
    sharesFor: string;
    sharesAgainst: string;
    direction: string | null;
    forLinear: string;
    forProgressive: string;
    againstLinear: string;
    againstProgressive: string;
  } | null;
};

type ConnectedConfidenceSliderProps = {
  tripleTermId: string;
  counterTermId?: string | null;
  className?: string;
  /** Called after a successful vote (optional — used by VoteSection to switch back to bar). */
  onVoteSuccess?: () => void;
  /** Called when user clicks the back button inside the slider. */
  onBack?: () => void;
};

export function ConnectedConfidenceSlider({
  tripleTermId,
  counterTermId = null,
  className,
  onVoteSuccess,
  onBack,
}: ConnectedConfidenceSliderProps) {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();

  const [actionStatus, setActionStatus] = useState<ActionStatus>("idle");
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [minDeposit, setMinDeposit] = useState<bigint | null>(null);
  const [existingDirection, setExistingDirection] = useState<"support" | "oppose" | null>(null);
  const [sliderResetKey, setSliderResetKey] = useState(0);

  const correctChain = chainId === intuitionTestnet.id;
  const walletReady = isConnected && walletClient && publicClient && correctChain;
  const sym = intuitionTestnet.nativeCurrency.symbol;
  const busy = actionStatus === "pending";

  // Load min deposit
  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        const data = await fetchJsonWithTimeout<{ minDeposit: string }>("/api/intuition/config");
        if (ok) setMinDeposit(BigInt(data.minDeposit));
      } catch { if (ok) setMinDeposit(null); }
    })();
    return () => { ok = false; };
  }, []);

  // Load user position
  const fetchUserPosition = useCallback(async (termId: string) => {
    try {
      const url = address
        ? `/api/vaults/${termId}?address=${address}`
        : `/api/vaults/${termId}`;
      const data = await fetchJsonWithTimeout<VaultResponse>(url, { cache: "no-store" });
      const pos = data.userPosition;
      if (pos) {
        const hasFor = BigInt(pos.sharesFor) > 0n;
        const hasAgainst = BigInt(pos.sharesAgainst) > 0n;
        if (hasFor) setExistingDirection("support");
        else if (hasAgainst) setExistingDirection("oppose");
        else setExistingDirection(null);
      } else {
        setExistingDirection(null);
      }
    } catch {
      setExistingDirection(null);
    }
  }, [address]);

  useEffect(() => {
    setExistingDirection(null);
    setActionStatus("idle");
    setActionMsg(null);
    if (tripleTermId) fetchUserPosition(tripleTermId);
  }, [tripleTermId, fetchUserPosition]);

  async function handleConfirm(result: ConfidenceSliderResult) {
    if (!walletClient || !publicClient) return;
    setActionStatus("pending");
    setActionMsg(null);

    if (!correctChain) {
      try { await switchChainAsync({ chainId: intuitionTestnet.id }); }
      catch { setActionMsg("Failed to switch network."); setActionStatus("error"); return; }
    }

    const weiAmount = parseEther(String(result.amount));
    if (minDeposit !== null && weiAmount < minDeposit) {
      setActionStatus("error");
      setActionMsg(`Min: ${formatEther(minDeposit)} ${sym}`);
      return;
    }

    const addr = getMultiVaultAddressFromChainId(intuitionTestnet.id);
    const res = await voteOnTriple({
      config: { walletClient, publicClient, address: addr },
      tripleTermId,
      counterTermId,
      direction: result.direction,
      amount: weiAmount,
      curveId: 1n,
    });

    if (res.ok) {
      setActionStatus("success");
      setActionMsg(`${result.direction === "support" ? "Support" : "Oppose"} confirmed.`);
      setSliderResetKey((k) => k + 1);
      fetchUserPosition(tripleTermId);
      onVoteSuccess?.();
    } else if (res.error?.includes("HasCounterStake")) {
      setActionMsg("You already have a position on the other side. Withdraw first.");
      setActionStatus("error");
      fetchUserPosition(tripleTermId);
    } else {
      setActionStatus("error");
      setActionMsg(res.error);
    }
  }

  return (
    <>
      <ConfidenceSlider
        key={sliderResetKey}
        onConfirm={handleConfirm}
        busy={busy}
        symbol={sym}
        existingDirection={existingDirection}
        onBack={onBack}
        className={className}
      />
      {!walletReady && (
        <p style={{ margin: 0, fontSize: "var(--font-size-tiny)", color: "var(--text-muted)", textAlign: "center" }}>
          Connect wallet to interact.
        </p>
      )}
      {actionStatus === "success" && actionMsg && (
        <p style={{ margin: 0, fontSize: "var(--font-size-tiny)", color: "var(--stance-supports-text)", textAlign: "center" }}>
          {actionMsg}
        </p>
      )}
      {actionStatus === "error" && actionMsg && (
        <p style={{ margin: 0, fontSize: "var(--font-size-tiny)", color: "var(--stance-refutes-text)", textAlign: "center" }}>
          {actionMsg}
        </p>
      )}
    </>
  );
}
