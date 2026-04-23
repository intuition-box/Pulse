"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { getMultiVaultAddressFromChainId } from "@0xintuition/sdk";
import { X } from "lucide-react";

import { intuitionTestnet } from "@/lib/chain";
import { intuitionGraphqlUrl } from "@/lib/intuition/intuition";
import { voteOnTriple } from "@/lib/intuition/intuitionVote";
import { fetchJsonWithTimeout } from "@/lib/net/fetchWithTimeout";
import { parseTxError } from "@/lib/getErrorMessage";
import { useToast } from "@/components/Toast/ToastContext";
import { Chip } from "@/components/Chip/Chip";
import styles from "./WeekVote.module.css";

/* ── Config ─────────────────────────────────────────────────────────── */

export type WeekVoteConfig = {
  question: string;
  subjectAtomId: string; // atom whose image illustrates the vote
  optionA: { tripleTermId: string; label: string; color: "blue" | "gold" };
  optionB: { tripleTermId: string; label: string; color: "blue" | "gold" };
};

export const WEEK_VOTE_CONFIG: WeekVoteConfig = {
  question: "What color is the dress?",
  subjectAtomId: "0xba3778e8c3c9e5938617c1cfe81d39d4446afe4064bf1875fbe07ded958f2527",
  optionA: {
    tripleTermId: "0x34476078fb7d2b49d88b0d038529a4e1f89e75de850084aa4387a470137e2188",
    label: "Black & Blue",
    color: "blue",
  },
  optionB: {
    tripleTermId: "0x630c06a0da8e933afa360774db2cf7e47b21ee413987eb4dfc140dc7a46bed67",
    label: "White & Gold",
    color: "gold",
  },
};

/* ── Atom image fetcher ─────────────────────────────────────────────── */

const IPFS_GATEWAY = "https://ipfs.io/ipfs/";

function resolveIpfs(url: string): string {
  if (url.startsWith("ipfs://")) return IPFS_GATEWAY + url.slice(7);
  return url;
}

function useAtomImage(atomId: string): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(intuitionGraphqlUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `query($id:String!){atom(term_id:$id){image}}`,
            variables: { id: atomId },
          }),
        });
        const json = await res.json() as { data?: { atom?: { image?: string | null } } };
        const raw = json.data?.atom?.image;
        if (!cancelled && raw) setSrc(resolveIpfs(raw));
      } catch {
        // no image
      }
    })();
    return () => { cancelled = true; };
  }, [atomId]);

  return src;
}

/* ── Types ───────────────────────────────────────────────────────────── */

type VaultResponse = {
  vault: {
    for: { positionCount: number };
    against: { positionCount: number };
  };
  userPosition: {
    sharesFor: string;
    sharesAgainst: string;
  } | null;
};

type VotedSide = "a" | "b" | null;

/* ── Shared logic hook ──────────────────────────────────────────────── */

function useWeekVote(config: WeekVoteConfig) {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const { addToast } = useToast();

  const [voted, setVoted] = useState<VotedSide>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ a: 0, b: 0 });

  const minDepositRef = useRef<bigint | null>(null);
  const correctChain = chainId === intuitionTestnet.id;

  // Fetch counts + user position for both options
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = address ? `?address=${address}` : "";
      const [dataA, dataB] = await Promise.all([
        fetchJsonWithTimeout<VaultResponse>(`/api/vaults/${config.optionA.tripleTermId}${qs}`, { cache: "no-store" }),
        fetchJsonWithTimeout<VaultResponse>(`/api/vaults/${config.optionB.tripleTermId}${qs}`, { cache: "no-store" }),
      ]);

      setCounts({
        a: dataA.vault.for.positionCount,
        b: dataB.vault.for.positionCount,
      });

      // Check which side (if any) the user voted on
      const hasA = BigInt(dataA.userPosition?.sharesFor ?? "0") > 0n;
      const hasB = BigInt(dataB.userPosition?.sharesFor ?? "0") > 0n;
      if (hasA) setVoted("a");
      else if (hasB) setVoted("b");
      else setVoted(null);
    } catch {
      // Keep defaults
    } finally {
      setLoading(false);
    }
  }, [config.optionA.tripleTermId, config.optionB.tripleTermId, address]);

  useEffect(() => {
    fetchData();
  }, [fetchData, config.optionA.tripleTermId]);

  async function ensureMinDeposit(): Promise<bigint | null> {
    if (minDepositRef.current !== null) return minDepositRef.current;
    try {
      const cfg = await fetchJsonWithTimeout<{ minDeposit: string }>("/api/intuition/config");
      minDepositRef.current = BigInt(cfg.minDeposit);
      return minDepositRef.current;
    } catch {
      return null;
    }
  }

  async function vote(side: "a" | "b") {
    if (!isConnected) {
      addToast("Connect wallet to vote", "info");
      return;
    }
    if (voted) return; // already voted
    if (!walletClient || !publicClient) return;

    setBusy(true);

    // Switch chain if needed
    if (!correctChain) {
      try {
        await switchChainAsync({ chainId: intuitionTestnet.id });
      } catch {
        addToast("Failed to switch network", "error");
        setBusy(false);
        return;
      }
    }

    const minDeposit = await ensureMinDeposit();
    if (minDeposit === null) {
      addToast("Failed to load config", "error");
      setBusy(false);
      return;
    }

    const tripleTermId = side === "a" ? config.optionA.tripleTermId : config.optionB.tripleTermId;
    const addr = getMultiVaultAddressFromChainId(intuitionTestnet.id);

    const result = await voteOnTriple({
      config: { walletClient, publicClient, address: addr },
      tripleTermId,
      direction: "support",
      amount: minDeposit,
      curveId: 1n,
    });

    if (result.ok) {
      setVoted(side);
      setCounts((c) => ({ ...c, [side]: c[side] + 1 }));
    } else {
      const { short, isReject } = parseTxError(result.error ?? "Vote failed");
      addToast(short, isReject ? "info" : "error");
    }

    setBusy(false);
  }

  const total = counts.a + counts.b;
  const pctA = total > 0 ? Math.round((counts.a / total) * 100) : 50;
  const pctB = total > 0 ? 100 - pctA : 50;

  return { voted, busy, loading, counts, total, pctA, pctB, vote };
}

/* ── Sidebar widget (desktop) ───────────────────────────────────────── */

export function WeekVote({ config = WEEK_VOTE_CONFIG }: { config?: WeekVoteConfig }) {
  const { voted, busy, loading, counts, total, pctA, pctB, vote } = useWeekVote(config);
  const imageSrc = useAtomImage(config.subjectAtomId);

  return (
    <div className={styles.widget}>
      <div className={styles.imageWrap}>
        {imageSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageSrc} alt={config.question} />
        )}
      </div>

      <p className={styles.question}>{config.question}</p>

      {voted ? (
        <Results config={config} counts={counts} pctA={pctA} pctB={pctB} />
      ) : (
        <>
          <div className={styles.meter}>
            <div className={styles.meterA} style={{ width: `${pctA}%` }} />
            <div className={styles.meterB} style={{ width: `${pctB}%` }} />
          </div>
          <div className={styles.stats}>
            <span>{pctA}% {config.optionA.label} · {pctB}% {config.optionB.label}</span>
            <span>{total} votes</span>
          </div>
          <div className={styles.buttons}>
            <Chip
              tone="supports"
              size="md"
              className={styles.voteChip}
              onClick={() => vote("a")}
              disabled={busy || loading}
            >
              {busy ? <span className={styles.spinner} /> : config.optionA.label}
            </Chip>
            <Chip
              tone="refutes"
              size="md"
              className={styles.voteChip}
              onClick={() => vote("b")}
              disabled={busy || loading}
            >
              {busy ? <span className={styles.spinner} /> : config.optionB.label}
            </Chip>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Mobile banner (dismissable) ────────────────────────────────────── */

const DISMISS_KEY = "week_vote_dismissed";

function isDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    // Expires after 24h
    return Date.now() - ts < 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function WeekVoteBanner({ config = WEEK_VOTE_CONFIG }: { config?: WeekVoteConfig }) {
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid flash
  const [imageExpanded, setImageExpanded] = useState(false);
  const { voted, busy, loading, counts, pctA, pctB, vote } = useWeekVote(config);
  const imageSrc = useAtomImage(config.subjectAtomId);

  useEffect(() => {
    setDismissed(isDismissed());
  }, []);

  useEffect(() => {
    if (!imageExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImageExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imageExpanded]);

  if (dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  }

  return (
    <div className={styles.banner}>
      <button
        type="button"
        className={styles.bannerImage}
        onClick={() => imageSrc && setImageExpanded(true)}
        aria-label="Open image"
        disabled={!imageSrc}
      >
        {imageSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageSrc} alt={config.question} />
        )}
      </button>

      {imageExpanded && imageSrc && (
        <button
          type="button"
          className={styles.imageOverlay}
          onClick={() => setImageExpanded(false)}
          aria-label="Close image"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageSrc} alt={config.question} className={styles.imageOverlayImg} />
        </button>
      )}

      <div className={styles.bannerContent}>
        <div className={styles.bannerHeader}>
          <div>
            <p className={styles.bannerTitle}>Quick Vote</p>
            <p className={styles.bannerQuestion}>{config.question}</p>
          </div>
          <button className={styles.dismissBtn} onClick={handleDismiss} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>

        {voted ? (
          <Results config={config} counts={counts} pctA={pctA} pctB={pctB} />
        ) : (
          <div className={styles.buttons}>
            <Chip
              tone="neutral"
              size="md"
              className={styles.voteChip}
              onClick={() => vote("a")}
              disabled={busy || loading}
            >
              {busy ? <span className={styles.spinner} /> : <span className={styles.colorDot} data-color={config.optionA.color} />}
              {config.optionA.label}
            </Chip>
            <Chip
              tone="neutral"
              size="md"
              className={styles.voteChip}
              onClick={() => vote("b")}
              disabled={busy || loading}
            >
              {busy ? <span className={styles.spinner} /> : <span className={styles.colorDot} data-color={config.optionB.color} />}
              {config.optionB.label}
            </Chip>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Shared results display ─────────────────────────────────────────── */

function Results({
  config,
  counts,
  pctA,
  pctB,
}: {
  config: WeekVoteConfig;
  counts: { a: number; b: number };
  pctA: number;
  pctB: number;
}) {
  return (
    <div className={styles.results}>
      <div className={styles.barTrack}>
        <div className={styles.barSegment} data-side="blue" style={{ width: `${pctA}%` }} />
        <div className={styles.barSegment} data-side="gold" style={{ width: `${pctB}%` }} />
      </div>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.colorDot} data-color={config.optionA.color} />
          {config.optionA.label}
          <span className={styles.legendPct}>{pctA}%</span>
          <span>({counts.a})</span>
        </span>
        <span className={styles.legendItem}>
          <span className={styles.colorDot} data-color={config.optionB.color} />
          {config.optionB.label}
          <span className={styles.legendPct}>{pctB}%</span>
          <span>({counts.b})</span>
        </span>
      </div>
    </div>
  );
}
