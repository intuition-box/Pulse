"use client";

import { useEffect, useMemo, useState } from "react";

import { ConnectedThumbVote } from "@/components/ThumbVote";
import { NestedTripleInline } from "@/components/TripleInline/NestedTripleInline";
import { MiniTree } from "@/components/MiniTree/MiniTree";
import { DebateCardView, type DebatePostData } from "@/app/_components/DebateThread/DebateCardView";
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
  subjectNested?: NestedTripleData | null;
  objectNested?: NestedTripleData | null;
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
  sharedAtom?: string;
};

type RelatedApiResponse = {
  exact: RelatedPost[];
  sameSubject: RelatedPost[];
  sameObject: RelatedPost[];
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
  subjectNested?: NestedTripleData | null;
  objectNested?: NestedTripleData | null;
};

function ClaimBlock({ data, nested }: { data: ClaimBlockData; nested?: boolean }) {
  return (
    <div className={nested ? styles.nestedClaimItem : styles.claimItem}>
      <NestedTripleInline data={data} wrap nested={nested} />
      <ConnectedThumbVote
        tripleTermId={data.termId}
        counterTermId={data.counterTermId ?? null}
        size="sm"
      />
    </div>
  );
}

// RelatedSection
function RelatedSection({ title, posts }: { title: string; posts: RelatedPost[] }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title} <span className={styles.count}>({posts.length})</span></h3>
      <div className={styles.postsList}>
        {posts.map((p) => {
          const postData: DebatePostData = {
            id: p.id,
            body: p.body,
            createdAt: p.createdAt,
            user: p.author,
            replyCount: p.replyCount,
            mainTripleTermIds: [p.mainTripleTermId],
          };
          return (
            <div key={p.id} className={styles.relatedPostItem}>
              <DebateCardView post={postData} dense />
              {p.sharedAtom && (
                <p className={styles.sharedTopicHint}>Shared: {p.sharedAtom}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
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
  const [sameSubjectPosts, setSameSubjectPosts] = useState<RelatedPost[]>([]);
  const [sameObjectPosts, setSameObjectPosts] = useState<RelatedPost[]>([]);
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
      if (!activeId) { setExactPosts([]); setSameSubjectPosts([]); setSameObjectPosts([]); setRelatedPosts([]); return; }
      setRelatedLoading(true);
      try {
        const qs = currentPostId ? `?exclude=${currentPostId}` : "";
        const data = await fetchJsonWithTimeout<RelatedApiResponse>(`/api/triples/${activeId}/related${qs}`);
        if (ok) {
          setExactPosts(data.exact || []);
          setSameSubjectPosts(data.sameSubject || []);
          setSameObjectPosts(data.sameObject || []);
          setRelatedPosts(data.related || []);
        }
      } catch {
        if (ok) { setExactPosts([]); setSameSubjectPosts([]); setSameObjectPosts([]); setRelatedPosts([]); }
      } finally {
        if (ok) setRelatedLoading(false);
      }
    })();
    return () => { ok = false; };
  }, [activeId, currentPostId]);

  const activeData = activeId ? tripleMap[activeId] : null;
  const activeErr = activeId ? tripleErrors[activeId] : null;

  const displayTriples = useMemo(() => {
    if (triples.length === 0) return triples;

    const linkedIds = new Set(triples.map((triple) => triple.termId));
    const nestedChildIds = new Set<string>();

    function collectChildIds(data: { subjectNested?: NestedTripleData | null; objectNested?: NestedTripleData | null }) {
      for (const nested of [data.subjectNested, data.objectNested]) {
        if (!nested || nestedChildIds.has(nested.termId)) continue;
        if (linkedIds.has(nested.termId)) nestedChildIds.add(nested.termId);
        collectChildIds(nested);
      }
    }

    for (const triple of triples) {
      const details = tripleMap[triple.termId];
      if (details) collectChildIds(details);
    }

    const filtered = triples.filter((triple) => !nestedChildIds.has(triple.termId));
    return filtered.length > 0 ? filtered : triples;
  }, [triples, tripleMap]);

  useEffect(() => {
    if (displayTriples.length === 0) return;

    const stillVisible = activeId ? displayTriples.some((triple) => triple.termId === activeId) : false;
    if (stillVisible) return;

    const nextId = displayTriples.find((triple) => triple.termId === defaultTripleTermId)?.termId
      ?? displayTriples[0]?.termId
      ?? null;
    if (nextId !== activeId) {
      setActiveId(nextId);
    }
  }, [activeId, defaultTripleTermId, displayTriples]);

  // Collect nested triples recursively (depth-first: deepest first)
  const nestedTriples = useMemo(() => {
    if (!activeData) return [];
    const result: NestedTripleData[] = [];
    const seen = new Set<string>();
    function walk(node: NestedTripleData | null | undefined) {
      if (!node || seen.has(node.termId)) return;
      seen.add(node.termId);
      walk(node.subjectNested);
      walk(node.objectNested);
      result.push(node);
    }
    walk(activeData.subjectNested);
    walk(activeData.objectNested);
    return result;
  }, [activeData]);

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
            {relatedLoading && (
              <div className={styles.relatedLoading}>
                <div className={styles.spinner} />
                <p>Looking for related debates...</p>
              </div>
            )}
            {!relatedLoading && exactPosts.length > 0 && (
              <RelatedSection title="Same claim" posts={exactPosts} />
            )}
            {!relatedLoading && sameSubjectPosts.length > 0 && (
              <RelatedSection title="Same subject" posts={sameSubjectPosts} />
            )}
            {!relatedLoading && sameObjectPosts.length > 0 && (
              <RelatedSection title="Same object" posts={sameObjectPosts} />
            )}
            {!relatedLoading && relatedPosts.length > 0 && (
              <RelatedSection title="Related" posts={relatedPosts} />
            )}
            {!relatedLoading && exactPosts.length === 0 && sameSubjectPosts.length === 0 && sameObjectPosts.length === 0 && relatedPosts.length === 0 && (
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
            {displayTriples.length > 1 && (
              <section className={styles.section}>
                <div className={styles.linkedList}>
                  {displayTriples.map((t) => {
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
