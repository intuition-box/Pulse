"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HotDebates } from "@/app/_components/TrendingScroll/TrendingScroll";
import { FeedThread, type ReplyTarget } from "@/app/_components/FeedPost/FeedThread";
import { HomeSidebar } from "@/app/_components/HomeSidebar/HomeSidebar";
import { RightPanel } from "@/app/_components/RightPanel/RightPanel";
import { Sheet } from "@/app/_components/Sheet/Sheet";
import { useIsMobile } from "@/app/_components/RightPanel/useIsMobile";
import { TripleInspector } from "@/components/TripleInspector/TripleInspector";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { WeekVoteBanner } from "@/app/_components/HomeSidebar/WeekVote";
import { useComposerFlow } from "@/features/post/ExtractionWorkspace/hooks/useComposerFlow";
import { ComposerBlock } from "@/features/post/ExtractionWorkspace/ComposerBlock";
import { labels } from "@/lib/vocabulary";
import { ThemeRow } from "@/components/ThemeSelector/ThemeRow";
import { useToast } from "@/components/Toast/ToastContext";
import { useSentimentBatch } from "@/hooks/useSentimentBatch";
import { useCreateTheme } from "@/features/theme/useCreateTheme";

import styles from "./page.module.css";

/* ── Types (exported for sub-components) ─────────────────────────────── */

export type TrendingPost = {
  id: string;
  body: string;
  themes: { slug: string; name: string }[];
  replyCount: number;
  mainTripleTermId: string | null;
};

export type FeedReplyPreview = {
  id: string;
  body: string;
  createdAt: string;
  user: { displayName: string | null; address: string; avatar: string | null };
  stance: "SUPPORTS" | "REFUTES" | null;
  mainTripleTermIds?: string[];
  replyCount: number;
  subReplies?: FeedReplyPreview[];
};

export type FeedPostData = {
  id: string;
  body: string;
  createdAt: string;
  user: { displayName: string | null; address: string; avatar: string | null };
  replyCount: number;
  stance: "SUPPORTS" | "REFUTES" | null;
  themes: { slug: string; name: string }[];
  mainTripleTermIds?: string[];
  replyPreviews: FeedReplyPreview[];
  /** Most recent activity in the thread (for "latest" sort) */
  latestActivityAt: string;
  /** Present only for replies — context about the parent post */
  parentContext: {
    id: string;
    bodyExcerpt: string;
  } | null;
};

export type ThemeSummary = {
  slug: string;
  name: string;
  postCount: number;
};

export type LoadMoreRepliesFn = (
  postId: string,
  offset: number,
) => Promise<{ replies: FeedReplyPreview[]; hasMore: boolean }>;

/* ── Sort options ────────────────────────────────────────────────────── */

export type FeedSort = "latest" | "oldest" | "popular";

const SORT_LABELS: Record<FeedSort, string> = {
  latest: "Most recent",
  oldest: "Oldest",
  popular: "Most reactions",
};

function sortFeed(posts: FeedPostData[], sort: FeedSort): FeedPostData[] {
  const sorted = [...posts];
  switch (sort) {
    case "latest":
      return sorted.sort((a, b) => b.latestActivityAt.localeCompare(a.latestActivityAt));
    case "oldest":
      return sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case "popular":
      return sorted.sort((a, b) => b.replyCount - a.replyCount);
  }
}

type HomePageClientProps = {
  trending: TrendingPost[];
  feed: FeedPostData[];
  themes: ThemeSummary[];
  loadMoreReplies: LoadMoreRepliesFn;
};

/* ── Inline Composer (isolated to re-mount via key) ──────────────────── */

function InlineComposerBlock({
  target,
  onClose,
  onPublishSuccess,
  onCreateTheme,
}: {
  target: ReplyTarget;
  onClose: () => void;
  onPublishSuccess: (postId: string) => void;
  onCreateTheme: (name: string) => Promise<{ slug: string; name: string } | null>;
}) {
  const [selectedThemes, setSelectedThemes] = useState(target.themes);
  const composerFlow = useComposerFlow({
    themeSlug: selectedThemes[0]?.slug ?? target.themeSlug,
    parentPostId: target.postId,
    parentMainTripleTermId: target.mainTripleTermId,
    onPublishSuccess,
    autoOpen: true,
    onClose,
  });

  useEffect(() => {
    composerFlow.flow.setStance(target.stance);
  }, [target.stance, composerFlow.flow.setStance]);

  return (
    <ComposerBlock
      composerFlow={composerFlow}
      themeSlot={
        <ThemeRow
          selected={selectedThemes}
          onChange={setSelectedThemes}
          min={1}
          onCreateTheme={onCreateTheme}
        />
      }
      extraDisabled={selectedThemes.length === 0}
      extraDisabledHint={selectedThemes.length === 0 ? labels.selectAtLeastOneTheme : undefined}
    />
  );
}

/* ── Home Page Component ─────────────────────────────────────────────── */

export function HomePageClient({ trending, feed, themes, loadMoreReplies }: HomePageClientProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const isMobile = useIsMobile();

  const { createTheme } = useCreateTheme();
  const handleCreateTheme = useCallback(async (name: string) => {
    const result = await createTheme(name, undefined, null);
    if (!result) return null;
    return { slug: result.slug, name: result.name };
  }, [createTheme]);

  const [sort, setSort] = useState<FeedSort>("latest");
  const [themeFilter, setThemeFilter] = useState<string | null>(null);

  const rootComposerRef = useRef<HTMLDivElement>(null);
  const [selectedThemes, setSelectedThemes] = useState<{ slug: string; name: string }[]>([]);

  // Inspector state
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTriples, setInspectorTriples] = useState<{ termId: string; role: "MAIN" }[]>([]);
  const [inspectorPostId, setInspectorPostId] = useState<string | null>(null);

  const [extraTripleIds, setExtraTripleIds] = useState<string[]>([]);
  const allTripleIds = useMemo(() => {
    const ids: string[] = [];
    for (const post of trending) {
      if (post.mainTripleTermId) ids.push(post.mainTripleTermId);
    }
    for (const post of feed) {
      if (post.mainTripleTermIds?.[0]) ids.push(post.mainTripleTermIds[0]);
      for (const reply of post.replyPreviews) {
        if (reply.mainTripleTermIds?.[0]) ids.push(reply.mainTripleTermIds[0]);
        for (const sub of reply.subReplies ?? []) {
          if (sub.mainTripleTermIds?.[0]) ids.push(sub.mainTripleTermIds[0]);
        }
      }
    }
    ids.push(...extraTripleIds);
    return ids;
  }, [trending, feed, extraTripleIds]);
  const { data: sentimentMap } = useSentimentBatch(allTripleIds);

  // Sort + filter
  const sortedFeed = useMemo(() => {
    let filtered = feed;
    if (themeFilter) {
      filtered = feed.filter((p) => p.themes.some((t) => t.slug === themeFilter));
    }
    return sortFeed(filtered, sort);
  }, [feed, sort, themeFilter]);

  // Reply state: replyTarget opens the Composer directly (stance chosen inside)
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);

  // Root composer flow (always open — inline at top of feed)
  const rootComposerFlow = useComposerFlow({
    themeSlug: selectedThemes[0]?.slug ?? "",
    parentPostId: null,
    onPublishSuccess: (postId) => {
      setSelectedThemes([]);
      addToast("Debate created", "success", { label: "See", href: `/posts/${postId}` }, 6000);
      router.refresh();
    },
    autoOpen: true,
    onClose: () => {},
  });


  function handleBadgeClick(tripleTermIds: string[], postId: string) {
    setInspectorTriples(tripleTermIds.map((id) => ({ termId: id, role: "MAIN" as const })));
    setInspectorPostId(postId);
    setReplyTarget(null);
    setInspectorOpen(true);
  }

  function handleReply(target: ReplyTarget) {
    setInspectorOpen(false);
    setReplyTarget(target);
  }

  const activeReplyMap = useMemo(() => {
    if (!replyTarget) return undefined;
    return new Map([[replyTarget.postId, replyTarget.stance]]);
  }, [replyTarget]);

  function handlePublishSuccess(postId: string) {
    setReplyTarget(null);
    addToast("Reply created", "success", { label: "See", href: `/posts/${postId}` }, 6000);
    router.refresh();
  }

  /** Render composer slot right after the matching postId */
  function composerSlot(postId: string) {
    if (!replyTarget || replyTarget.postId !== postId) return null;
    return (
      <div className={styles.inlineComposer}>
        <InlineComposerBlock
          key={postId}
          target={replyTarget}
          onClose={() => setReplyTarget(null)}
          onPublishSuccess={handlePublishSuccess}
          onCreateTheme={handleCreateTheme}
        />
      </div>
    );
  }

  const inspectorKey = inspectorTriples.map((t) => t.termId).join(",");
  const inspectorContent = inspectorTriples.length > 0 ? (
    <TripleInspector
      key={inspectorKey}
      triples={inspectorTriples}
      defaultTripleTermId={inspectorTriples[0]?.termId ?? null}
      currentPostId={inspectorPostId}
    />
  ) : null;

  return (
    <div className={styles.pageWrapper}>
      <div className={styles.page}>
        <div className={styles.feedColumn}>
          {isMobile && <WeekVoteBanner />}
          <HotDebates posts={trending} sentimentMap={sentimentMap} />

          {/* Root composer — always visible at top of feed */}
          <div ref={rootComposerRef} className={styles.rootComposer}>
            <ComposerBlock
              composerFlow={rootComposerFlow}
              hideHeader
              placeholder="Start a debate"
              themeSlot={
                <ThemeRow
                  selected={selectedThemes}
                  onChange={setSelectedThemes}
                  min={1}
                  onCreateTheme={handleCreateTheme}
                />
              }
              extraDisabled={selectedThemes.length === 0}
      extraDisabledHint={selectedThemes.length === 0 ? labels.selectAtLeastOneTheme : undefined}
            />
          </div>

          {/* Sort + filter bar */}
          <div className={styles.sortBar}>
            <div className={styles.sortButtons}>
              {(Object.keys(SORT_LABELS) as FeedSort[]).map((key) => (
                <button
                  key={key}
                  className={`${styles.sortBtn} ${sort === key ? styles.sortBtnActive : ""}`}
                  onClick={() => setSort(key)}
                >
                  {SORT_LABELS[key]}
                </button>
              ))}
            </div>
            {themes.length > 0 && (
              <div className={styles.sortRight}>
                <select
                  className={styles.themeSelect}
                  value={themeFilter ?? ""}
                  onChange={(e) => setThemeFilter(e.target.value || null)}
                >
                  <option value="">All themes</option>
                  {themes.map((t) => (
                    <option key={t.slug} value={t.slug}>{t.name.toUpperCase()}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className={styles.feedList}>
            {sortedFeed.length === 0 ? (
              <EmptyState title={themeFilter ? "No posts in this theme." : "No posts yet. Start a debate!"} />
            ) : (
              sortedFeed.map((post) => (
                <FeedThread
                  key={post.id}
                  post={post}
                  onBadgeClick={handleBadgeClick}
                  onReply={handleReply}
                  activeReplyMap={activeReplyMap}
                  composerSlot={composerSlot}
                  loadMoreReplies={loadMoreReplies}
                  sentimentMap={sentimentMap}
                  onNewTripleIds={(ids) => setExtraTripleIds((prev) => [...prev, ...ids])}
                />
              ))
            )}
          </div>
        </div>

        <HomeSidebar themes={themes} />
      </div>

      {/* Desktop inspector — overlays the sidebar */}
      {!isMobile && inspectorOpen && inspectorTriples.length > 0 && (
        <div className={styles.inspectorOverlay}>
          <RightPanel
            open
            title="Protocol Inspector"
            onClose={() => setInspectorOpen(false)}
          >
            {inspectorContent}
          </RightPanel>
        </div>
      )}

      {/* Mobile inspector sheet */}
      {isMobile && (
        <Sheet
          open={inspectorOpen && inspectorTriples.length > 0}
          onOpenChange={setInspectorOpen}
          title="Protocol Inspector"
        >
          {inspectorContent}
        </Sheet>
      )}
    </div>
  );
}
