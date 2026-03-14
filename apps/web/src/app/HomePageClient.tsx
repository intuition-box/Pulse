"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TrendingScroll } from "@/app/_components/TrendingScroll/TrendingScroll";
import { FeedThread, type ReplyTarget } from "@/app/_components/FeedPost/FeedThread";
import { HomeSidebar } from "@/app/_components/HomeSidebar/HomeSidebar";
import { RightPanel } from "@/app/_components/RightPanel/RightPanel";
import { Sheet } from "@/app/_components/Sheet/Sheet";
import { useIsMobile } from "@/app/_components/RightPanel/useIsMobile";
import { TripleInspector } from "@/components/TripleInspector/TripleInspector";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { useComposerFlow } from "@/features/post/ExtractionWorkspace/hooks/useComposerFlow";
import { ComposerBlock } from "@/features/post/ExtractionWorkspace/ComposerBlock";
import { useToast } from "@/components/Toast/ToastContext";
import { useSentimentBatch } from "@/hooks/useSentimentBatch";

import styles from "./page.module.css";

/* ── Types (exported for sub-components) ─────────────────────────────── */

export type TrendingPost = {
  id: string;
  body: string;
  theme: { slug: string; name: string };
  replyCount: number;
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
  theme: { slug: string; name: string };
  mainTripleTermIds?: string[];
  replyPreviews: FeedReplyPreview[];
};

export type HotTopic = {
  id: string;
  body: string;
  replyCount: number;
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

type HomePageClientProps = {
  trending: TrendingPost[];
  feed: FeedPostData[];
  hotTopics: HotTopic[];
  themes: ThemeSummary[];
  loadMoreReplies: LoadMoreRepliesFn;
};

/* ── Inline Composer (isolated to re-mount via key) ──────────────────── */

function InlineComposerBlock({
  target,
  onClose,
  onPublishSuccess,
}: {
  target: ReplyTarget;
  onClose: () => void;
  onPublishSuccess: (postId: string) => void;
}) {
  const composerFlow = useComposerFlow({
    themeSlug: target.themeSlug,
    parentPostId: target.postId,
    parentMainTripleTermId: target.mainTripleTermId,
    onPublishSuccess,
    autoOpen: true,
    onClose,
  });

  return <ComposerBlock composerFlow={composerFlow} />;
}

/* ── Home Page Component ─────────────────────────────────────────────── */

export function HomePageClient({ trending, feed, hotTopics, themes, loadMoreReplies }: HomePageClientProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const isMobile = useIsMobile();

  // Inspector state
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTriples, setInspectorTriples] = useState<{ termId: string; role: "MAIN" }[]>([]);
  const [inspectorPostId, setInspectorPostId] = useState<string | null>(null);

  // Sentiment data: collect all tripleIds from feed + track extra from "show more"
  const [extraTripleIds, setExtraTripleIds] = useState<string[]>([]);
  const feedTripleIds = useMemo(() => {
    const ids: string[] = [];
    for (const post of feed) {
      if (post.mainTripleTermIds?.[0]) ids.push(post.mainTripleTermIds[0]);
      for (const reply of post.replyPreviews) {
        if (reply.mainTripleTermIds?.[0]) ids.push(reply.mainTripleTermIds[0]);
        for (const sub of reply.subReplies ?? []) {
          if (sub.mainTripleTermIds?.[0]) ids.push(sub.mainTripleTermIds[0]);
        }
      }
    }
    return ids;
  }, [feed]);
  const allTripleIds = useMemo(
    () => [...feedTripleIds, ...extraTripleIds],
    [feedTripleIds, extraTripleIds],
  );
  const { data: sentimentMap } = useSentimentBatch(allTripleIds);

  // Reply state: replyTarget opens the Composer directly (stance chosen inside)
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);

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
          <TrendingScroll posts={trending} />

          <div className={styles.feedList}>
            {feed.length === 0 ? (
              <EmptyState title="No posts yet. Start a debate!" />
            ) : (
              feed.map((post) => (
                <FeedThread
                  key={post.id}
                  post={post}
                  onBadgeClick={handleBadgeClick}
                  onReply={handleReply}
                  composerSlot={composerSlot}
                  loadMoreReplies={loadMoreReplies}
                  sentimentMap={sentimentMap}
                  onNewTripleIds={(ids) => setExtraTripleIds((prev) => [...prev, ...ids])}
                />
              ))
            )}
          </div>
        </div>

        <HomeSidebar hotTopics={hotTopics} themes={themes} />
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
