"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";

import { SentimentBar } from "./SentimentBar";
import { fetchJsonWithTimeout } from "@/lib/net/fetchWithTimeout";

import styles from "./VoteSection.module.css";

/* ── Vault response (same shape as /api/vaults/[tripleId]) ──────────── */

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

/* ── Props ───────────────────────────────────────────────────────────── */

type VoteSectionProps = {
  tripleTermId: string;
  refreshKey?: number;
};

/* ── Component ───────────────────────────────────────────────────────── */

export function VoteSection({ tripleTermId, refreshKey = 0 }: VoteSectionProps) {
  const { address } = useAccount();

  const [loading, setLoading] = useState(true);
  const [supportPct, setSupportPct] = useState(50);
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [forCount, setForCount] = useState(0);
  const [againstCount, setAgainstCount] = useState(0);

  const fetchVaultData = useCallback(async () => {
    setLoading(true);
    try {
      const url = address
        ? `/api/vaults/${tripleTermId}?address=${address}`
        : `/api/vaults/${tripleTermId}`;

      const data = await fetchJsonWithTimeout<FullVaultResponse>(url, { cache: "no-store" });

      // Score by person count (not assets)
      const fc = data.vault.for.positionCount;
      const ac = data.vault.against.positionCount;
      const totalCount = fc + ac;

      setSupportPct(totalCount > 0 ? Math.round((fc / totalCount) * 100) : 50);
      setTotalParticipants(totalCount);
      setForCount(fc);
      setAgainstCount(ac);
    } catch {
      // Keep previous values on error
    } finally {
      setLoading(false);
    }
  }, [tripleTermId, address]);

  useEffect(() => {
    fetchVaultData();
  }, [fetchVaultData, refreshKey]);

  return (
    <div className={styles.wrapper}>
      <SentimentBar
        supportPct={supportPct}
        totalParticipants={totalParticipants}
        loading={loading}
        forCount={forCount}
        againstCount={againstCount}
      />
    </div>
  );
}
