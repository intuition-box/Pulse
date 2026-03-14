"use client";

import { useEffect, useState } from "react";

import { ConnectedThumbVote } from "@/components/ThumbVote";
import { TripleInline } from "@/components/TripleInline/TripleInline";
import { MiniTree } from "@/components/MiniTree/MiniTree";
import { ReplyCard } from "@/app/_components/ReplyCard/ReplyCard";
import { fetchJsonWithTimeout } from "@/lib/net/fetchWithTimeout";

import styles from "./TripleInspector.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────
type NestedTripleData = {
  termId: string;
  subject: string;
  predicate: string;
  object: string;
  counterTermId: string | null;
  marketCap: number | null;
  holders: number | null;
  shares: number | null;
};

type TripleData = {
  termId: string;
  subject: string;
  predicate: string;
  object: string;
  marketCap: number | null;
  holders: number | null;
  shares: number | null;
  createdAt: string;
  creator: string;
  counterTermId: string | null;
  subjectNested: NestedTripleData | null;
  objectNested: NestedTripleData | null;
};

type TripleApiResponse = {
  triple: {
    id?: string;
    subject: string;
    predicate: string;
    object: string;
    marketCap?: number | null;
    holders?: number | null;
    shares?: number | null;
    createdAt?: string;
    creator?: string;
    counterTermId?: string | null;
    subjectNested?: NestedTripleData | null;
    objectNested?: NestedTripleData | null;
  };
};

type RelatedPost = {
  id: string;
  body: string;
  createdAt: string;
  replyCount: number;
  author: {
    displayName: string | null;
    address: string;
    avatar: string | null;
  };
  mainTripleTermId: string;
  score?: 1 | 2 | 3;
  sharedTopics?: string[];
};

type RelatedApiResponse = {
  exact: RelatedPost[];
  related: RelatedPost[];
};

type LinkedTriple = {
  termId: string;
  role: "MAIN" | "SUPPORTING";
};

type MiniTreeData = {
  breadcrumbs: { id: string; body: string }[];
  focusNode: { id: string; body: string };
  replies: { id: string; body: string; stance: "SUPPORTS" | "REFUTES" }[];
};

type TripleInspectorProps = {
  triples: LinkedTriple[];
  defaultTripleTermId?: string | null;
  currentPostId?: string | null;
  miniTreeData?: MiniTreeData;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(value?: number | null) {
  if (value === null || value === undefined) return "\u2014";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function fmtId(id: string) {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}\u2026${id.slice(-4)}`;
}

// ─── ClaimBlock ───────────────────────────────────────────────────────────────
type ClaimBlockData = {
  termId: string;
  subject: string;
  predicate: string;
  object: string;
  counterTermId: string | null;
  marketCap: number | null;
  holders: number | null;
  shares: number | null;
};

function ClaimBlock({ data, nested }: { data: ClaimBlockData; nested?: boolean }) {
  return (
    <div className={nested ? styles.nestedClaimItem : styles.claimItem}>
      <TripleInline subject={data.subject} predicate={data.predicate} object={data.object} nested={nested} wrap />
      <ConnectedThumbVote
        tripleTermId={data.termId}
        counterTermId={data.counterTermId ?? null}
        size="sm"
      />
      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}><span className={styles.metricLabel}>Staked</span><span className={styles.metricValue}>{fmt(data.marketCap)}</span></div>
        <div className={styles.metricCard}><span className={styles.metricLabel}>Participants</span><span className={styles.metricValue}>{fmt(data.holders)}</span></div>
        <div className={styles.metricCard}><span className={styles.metricLabel}>Shares</span><span className={styles.metricValue}>{fmt(data.shares)}</span></div>
      </div>
    </div>
  );
}

// ─── Tab type ─────────────────────────────────────────────────────────────────
type Tab = "related" | "structure";

// ─── Component ────────────────────────────────────────────────────────────────
export function TripleInspector({ triples, defaultTripleTermId, currentPostId, miniTreeData }: TripleInspectorProps) {
  const initial = triples.find((t) => t.termId === defaultTripleTermId)?.termId ?? triples[0]?.termId ?? null;
  const [activeId, setActiveId] = useState<string | null>(initial);
  const [tripleMap, setTripleMap] = useState<Record<string, TripleData>>({});
  const [tripleErrors, setTripleErrors] = useState<Record<string, string>>({});
  const [exactPosts, setExactPosts] = useState<RelatedPost[]>([]);
  const [relatedPosts, setRelatedPosts] = useState<RelatedPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("related");
  const [treeOpen, setTreeOpen] = useState(false);

  // Load all triples
  useEffect(() => {
    let ok = true;
    (async () => {
      if (!triples.length) { setError("No triples linked."); setIsLoading(false); return; }
      setIsLoading(true); setError(null); setTripleErrors({});

      const results = await Promise.allSettled(
        triples.map(async (t) => {
          const data = await fetchJsonWithTimeout<TripleApiResponse>(`/api/triples/${t.termId}`);
          return { termId: t.termId, triple: data.triple };
        })
      );
      if (!ok) return;

      const map: Record<string, TripleData> = {};
      const errs: Record<string, string> = {};
      let hasAnyTriple = false;
      results.forEach((r, i) => {
        const tid = triples[i]?.termId;
        if (!tid) return;
        if (r.status === "fulfilled") {
          hasAnyTriple = true;
          const d = r.value.triple;
          map[tid] = {
            termId: d.id || tid,
            subject: d.subject,
            predicate: d.predicate,
            object: d.object,
            marketCap: d.marketCap ?? null,
            holders: d.holders ?? null,
            shares: d.shares ?? null,
            createdAt: d.createdAt || new Date().toISOString(),
            creator: d.creator || "Unknown",
            counterTermId: d.counterTermId ?? null,
            subjectNested: d.subjectNested ?? null,
            objectNested: d.objectNested ?? null,
          };
        } else {
          errs[tid] = r.reason?.message || "Failed";
        }
      });
      setTripleMap(map); setTripleErrors(errs);
      setError(hasAnyTriple ? null : "Failed to load triple data"); setIsLoading(false);
    })();
    return () => { ok = false; };
  }, [triples]);

  // Load related posts
  useEffect(() => {
    let ok = true;
    (async () => {
      if (!activeId) { setExactPosts([]); setRelatedPosts([]); return; }
      setRelatedLoading(true);
      try {
        const qs = currentPostId ? `?exclude=${currentPostId}` : "";
        const data = await fetchJsonWithTimeout<RelatedApiResponse>(`/api/triples/${activeId}/related${qs}`);
        if (ok) {
          setExactPosts(data.exact || []);
          setRelatedPosts(data.related || []);
        }
      } catch {
        if (ok) { setExactPosts([]); setRelatedPosts([]); }
      } finally {
        if (ok) setRelatedLoading(false);
      }
    })();
    return () => { ok = false; };
  }, [activeId, currentPostId]);

  const activeData = activeId ? tripleMap[activeId] : null;
  const activeErr = activeId ? tripleErrors[activeId] : null;

  // Collect unique nested triples for the active triple (dedup by termId)
  const nestedTriples: NestedTripleData[] = [];
  if (activeData) {
    const seen = new Set<string>();
    for (const nested of [activeData.subjectNested, activeData.objectNested]) {
      if (nested && !seen.has(nested.termId)) {
        seen.add(nested.termId);
        nestedTriples.push(nested);
      }
    }
  }

  if (isLoading) return <div className={styles.loadingState}><p>Loading triple data...</p></div>;
  if (error) return <div className={styles.errorState}><p>{error}</p></div>;

  return (
    <div className={styles.inspector}>
      {/* Tab bar */}
      <div className={styles.tabBar} role="tablist">
        <button
          role="tab"
          id="tab-related"
          aria-selected={tab === "related"}
          aria-controls="panel-related"
          className={`${styles.tabButton} ${tab === "related" ? styles.tabButtonActive : ""}`}
          onClick={() => setTab("related")}
        >
          Related
        </button>
        <button
          role="tab"
          id="tab-structure"
          aria-selected={tab === "structure"}
          aria-controls="panel-structure"
          className={`${styles.tabButton} ${tab === "structure" ? styles.tabButtonActive : ""}`}
          onClick={() => setTab("structure")}
        >
          Structure
        </button>
      </div>

      {/* Tab 1: Related */}
      <div
        role="tabpanel"
        id="panel-related"
        aria-labelledby="tab-related"
        hidden={tab !== "related"}
      >
        {tab === "related" && (
          <div className={styles.tabPanel}>
            {/* Related posts */}
            {relatedLoading && <p className={styles.hint}>Loading related posts...</p>}
            {!relatedLoading && exactPosts.length > 0 && (
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Same claim <span className={styles.count}>({exactPosts.length})</span></h3>
                <div className={styles.postsList}>
                  {exactPosts.map((p) => (
                    <ReplyCard
                      key={p.id}
                      id={p.id}
                      body={p.body}
                      createdAt={p.createdAt}
                      replyCount={p.replyCount}
                      author={p.author}
                      variant="compact"
                      mainTripleTermId={p.mainTripleTermId}
                    />
                  ))}
                </div>
              </section>
            )}
            {!relatedLoading && relatedPosts.length > 0 && (
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Related debates <span className={styles.count}>({relatedPosts.length})</span></h3>
                <div className={styles.postsList}>
                  {relatedPosts.map((p) => (
                    <div key={p.id} className={styles.relatedPostItem}>
                      <ReplyCard
                        id={p.id}
                        body={p.body}
                        createdAt={p.createdAt}
                        replyCount={p.replyCount}
                        author={p.author}
                        variant="compact"
                        mainTripleTermId={p.mainTripleTermId}
                      />
                      {p.sharedTopics && p.sharedTopics.length > 0 && (
                        <p className={styles.sharedTopicHint}>Shared: {p.sharedTopics.join(", ")}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
            {!relatedLoading && exactPosts.length === 0 && relatedPosts.length === 0 && (
              <p className={styles.emptyState}>No related debates yet</p>
            )}

            {/* MiniTree (optional — only on post page) */}
            {miniTreeData && (
              <section className={styles.section}>
                <div className={styles.miniTreeToggle}>
                  <button className={styles.miniTreeBtn} onClick={() => setTreeOpen(!treeOpen)}>
                    {treeOpen ? "Hide map" : "View map"}
                  </button>
                </div>
                <div className={`${styles.miniTreeWrapper} ${treeOpen ? styles.miniTreeWrapperOpen : ""}`}>
                  <MiniTree
                    ancestors={miniTreeData.breadcrumbs}
                    focusNode={miniTreeData.focusNode}
                    basePath="/posts"
                  >
                    {miniTreeData.replies}
                  </MiniTree>
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* Tab 2: Structure */}
      <div
        role="tabpanel"
        id="panel-structure"
        aria-labelledby="tab-structure"
        hidden={tab !== "structure"}
      >
        {tab === "structure" && (
          <div className={styles.tabPanel}>
            {/* Triple selector (if multiple) */}
            {triples.length > 1 && (
              <section className={styles.section}>
                <div className={styles.linkedList}>
                  {triples.map((t) => {
                    const d = tripleMap[t.termId];
                    return (
                      <button key={t.termId} type="button" className={`${styles.linkedItem} ${t.termId === activeId ? styles.linkedItemActive : ""}`} onClick={() => setActiveId(t.termId)}>
                        <div className={styles.linkedBody}>{d ? `${d.subject} — ${d.predicate} — ${d.object}` : fmtId(t.termId)}</div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Active triple */}
            {activeErr && !activeData && (
              <div className={styles.errorState}><p>{activeErr}</p></div>
            )}
            {activeData && (
              <>
                <ClaimBlock data={activeData} />
                {nestedTriples.map((nested) => (
                  <ClaimBlock key={nested.termId} data={nested} nested />
                ))}
              </>
            )}
            {!activeData && !activeErr && (
              <p className={styles.emptyState}>No triple selected</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
