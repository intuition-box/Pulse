"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trophy, Plus } from "lucide-react";

import { ConnectedThumbVote } from "@/components/ThumbVote/ConnectedThumbVote";
import { ThumbVote } from "@/components/ThumbVote/ThumbVote";
import { AtomSuggestionInput } from "@/components/AtomSuggestionInput/AtomSuggestionInput";
import { useSentimentBatch } from "@/hooks/useSentimentBatch";
import { intuitionGraphqlUrl } from "@/lib/intuition/intuition";
import { TRIPLE_QUERY, type GraphqlTriple } from "@/lib/intuition/graphql-queries";
import { useToast } from "@/components/Toast/ToastContext";
import type { RankingConfig } from "@/lib/rankings";
import { useAddCandidate } from "./useAddCandidate";
import styles from "./RankingWidget.module.css";

type RankingCandidate = {
  tripleTermId: string;
  subjectLabel: string;
  postId: string | null;
};

type SortedCandidate = {
  key: string;
  label: string;
  tripleTermId: string | null;
  postId: string | null;
  forCount: number;
  againstCount: number;
  rank: number;
};

function useRankingCandidates(config: RankingConfig) {
  const [candidates, setCandidates] = useState<RankingCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (config.predicateTermId === "TODO" || config.objectTermId === "TODO") {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(intuitionGraphqlUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: TRIPLE_QUERY,
            variables: {
              where: {
                predicate_id: { _eq: config.predicateTermId },
                object_id: { _eq: config.objectTermId },
              },
              limit: 50,
            },
          }),
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) { setLoading(false); return; }
        const payload = await res.json();
        const triples: GraphqlTriple[] = payload?.data?.triples ?? [];

        const rawCandidates = triples
          .filter((t) => t.term_id && t.subject?.label)
          .map((t) => ({ tripleTermId: t.term_id!, subjectLabel: t.subject!.label! }));

        if (cancelled || rawCandidates.length === 0) {
          if (!cancelled) { setCandidates([]); setLoading(false); }
          return;
        }

        const termIds = rawCandidates.map((c) => c.tripleTermId);
        const postRes = await fetch("/api/triples/posts-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ termIds }),
        });
        const postMap: Record<string, string> = postRes.ok ? await postRes.json() : {};

        if (!cancelled) {
          setCandidates(
            rawCandidates.map((c) => ({
              ...c,
              postId: postMap[c.tripleTermId] ?? null,
            })),
          );
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [config.predicateTermId, config.objectTermId]);

  return { candidates, loading };
}

const MOCK: SortedCandidate[] = [
  { key: "tiktok", label: "TikTok", tripleTermId: null, postId: null, forCount: 12, againstCount: 4, rank: 1 },
  { key: "instagram", label: "Instagram", tripleTermId: null, postId: null, forCount: 9, againstCount: 6, rank: 2 },
  { key: "youtube", label: "YouTube", tripleTermId: null, postId: null, forCount: 8, againstCount: 3, rank: 3 },
  { key: "twitter", label: "X (Twitter)", tripleTermId: null, postId: null, forCount: 5, againstCount: 7, rank: 4 },
  { key: "snapchat", label: "Snapchat", tripleTermId: null, postId: null, forCount: 3, againstCount: 5, rank: 5 },
];

export function RankingWidget({ config }: { config: RankingConfig }) {
  const isMock = config.predicateTermId === "TODO";
  const { candidates, loading } = useRankingCandidates(config);
  const router = useRouter();
  const { addToast } = useToast();

  const tripleIds = useMemo(() => candidates.map((c) => c.tripleTermId), [candidates]);
  const { data: sentimentMap } = useSentimentBatch(tripleIds);

  const [addOpen, setAddOpen] = useState(false);
  const [atomQuery, setAtomQuery] = useState("");
  const [lockedAtomId, setLockedAtomId] = useState<string | null>(null);
  const [lockedLabel, setLockedLabel] = useState("");

  const { busy: addBusy, error: addError, addCandidate } = useAddCandidate();

  async function handleAdd() {
    if (!lockedLabel.trim()) return;

    const result = await addCandidate({
      candidateLabel: lockedLabel,
      existingAtomTermId: lockedAtomId,
      predicateTermId: config.predicateTermId,
      objectTermId: config.objectTermId,
      categoryLabel: config.label,
      themeSlug: config.themeSlug,
      themeAtomTermId: config.themeAtomTermId,
    });

    if (result) {
      setAddOpen(false);
      setAtomQuery("");
      setLockedAtomId(null);
      setLockedLabel("");
      addToast("Candidate added!", "success", { label: "See", href: `/posts/${result.postId}` }, 6000);
      router.refresh();
    }
  }

  function handleCancel() {
    setAddOpen(false);
    setAtomQuery("");
    setLockedAtomId(null);
    setLockedLabel("");
  }

  const sorted: SortedCandidate[] = useMemo(() => {
    if (isMock) return MOCK;
    return candidates
      .map((c) => {
        const s = sentimentMap[c.tripleTermId];
        return {
          key: c.tripleTermId,
          label: c.subjectLabel,
          tripleTermId: c.tripleTermId,
          postId: c.postId,
          forCount: s?.forCount ?? 0,
          againstCount: s?.againstCount ?? 0,
          rank: 0,
        };
      })
      .sort((a, b) => (b.forCount - b.againstCount) - (a.forCount - a.againstCount))
      .slice(0, 10)
      .map((c, i) => ({ ...c, rank: i + 1 }));
  }, [isMock, candidates, sentimentMap]);

  if (loading) return null;
  if (!isMock && sorted.length === 0 && !addOpen) return null;

  return (
    <div className={styles.widget}>
      <span className={styles.surtitle}>Ranking of the month</span>
      <h3 className={styles.title}>
        <Trophy size={14} />
        The best {config.label} is...
      </h3>

      <div className={styles.list}>
        {sorted.map((item) => {
          const netScore = item.forCount - item.againstCount;
          const total = item.forCount + item.againstCount;
          const supportPct = total > 0 ? Math.round((item.forCount / total) * 100) : 0;

          return (
            <div key={item.key} className={styles.candidateRow}>
              <span className={styles.rank}>{item.rank}</span>
              <div className={styles.candidateInfo}>
                {item.postId ? (
                  <Link href={`/posts/${item.postId}`} className={styles.candidateLink}>
                    {item.label}
                  </Link>
                ) : (
                  <span className={styles.candidateLabel}>{item.label}</span>
                )}
                {total > 0 && (
                  <div className={styles.miniBar}>
                    <div className={styles.miniBarSupport} style={{ width: `${supportPct}%` }} />
                    <div className={styles.miniBarOppose} />
                  </div>
                )}
              </div>
              <span className={`${styles.netScore} ${netScore >= 0 ? styles.netScorePositive : styles.netScoreNegative}`}>
                {netScore >= 0 ? `+${netScore}` : netScore}
              </span>
              {item.tripleTermId ? (
                <ConnectedThumbVote
                  tripleTermId={item.tripleTermId}
                  sentimentData={sentimentMap[item.tripleTermId] ?? null}
                  size="sm"
                  onVoteSuccess={() => {
                    addToast(
                      "Vote registered!",
                      "success",
                      item.postId ? { label: "Say why", href: `/posts/${item.postId}` } : undefined,
                      6000,
                    );
                  }}
                />
              ) : (
                <ThumbVote
                  forCount={item.forCount}
                  againstCount={item.againstCount}
                  userDirection={null}
                  onVote={() => {}}
                  busy={false}
                  disabled
                  size="sm"
                />
              )}
            </div>
          );
        })}
      </div>

      {!isMock && !addOpen && (
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => setAddOpen(true)}
        >
          <Plus size={12} /> Add a candidate
        </button>
      )}

      {!isMock && addOpen && (
        <div className={styles.addSection}>
          <AtomSuggestionInput
            id="ranking-add-candidate"
            label="Candidate"
            value={atomQuery}
            lockedAtomId={lockedAtomId}
            placeholder="Search or create an atom"
            onChange={setAtomQuery}
            onLock={(atomId, label) => {
              setLockedAtomId(atomId);
              setLockedLabel(label);
              setAtomQuery(label);
            }}
            onUnlock={() => {
              setLockedAtomId(null);
              setLockedLabel("");
            }}
            onCreateNew={(label) => {
              setLockedAtomId(null);
              setLockedLabel(label);
              setAtomQuery(label);
            }}
          />

          {addError && <p className={styles.addError}>{addError}</p>}

          <div className={styles.addActions}>
            <button
              type="button"
              className={styles.addSubmit}
              onClick={handleAdd}
              disabled={!lockedLabel.trim() || addBusy}
            >
              {addBusy ? "Adding..." : "Add"}
            </button>
            <button
              type="button"
              className={styles.addCancel}
              onClick={handleCancel}
              disabled={addBusy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
