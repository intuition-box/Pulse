"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import type { FeedPostData, FeedReplyPreview, LoadMoreRepliesFn } from "@/app/HomePageClient";
import type { SentimentMap } from "@/hooks/useSentimentBatch";
import { FeedPost } from "./FeedPost";
import { ReplyPreview } from "./ReplyPreview";
import styles from "./FeedPost.module.css";

export type ReplyTarget = {
  postId: string;
  themeSlug: string;
  themes: { slug: string; name: string }[];
  mainTripleTermId: string | null;
  stance: "SUPPORTS" | "REFUTES";
};

type FeedThreadProps = {
  post: FeedPostData;
  onBadgeClick?: (tripleTermIds: string[], postId: string) => void;
  onReply?: (target: ReplyTarget) => void;
  /** postId → active stance, used to highlight the active reply button */
  activeReplyMap?: Map<string, "SUPPORTS" | "REFUTES">;
  composerSlot?: (postId: string) => ReactNode;
  loadMoreReplies?: LoadMoreRepliesFn;
  sentimentMap?: SentimentMap;
  onNewTripleIds?: (ids: string[]) => void;
};

export function FeedThread({ post, onBadgeClick, onReply, activeReplyMap, composerSlot, loadMoreReplies, sentimentMap, onNewTripleIds }: FeedThreadProps) {
  const [extraReplies, setExtraReplies] = useState<FeedReplyPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(post.replyCount > post.replyPreviews.length);

  const allReplies = [...post.replyPreviews, ...extraReplies];
  const remaining = post.replyCount - allReplies.length;

  async function handleLoadMore() {
    if (!loadMoreReplies) return;
    setLoading(true);
    try {
      const result = await loadMoreReplies(post.id, allReplies.length);
      setExtraReplies((prev) => [...prev, ...result.replies]);
      setHasMore(result.hasMore);

      // Notify parent of new tripleIds for sentiment batch
      const newIds = result.replies.flatMap((r) => {
        const ids: string[] = [];
        if (r.mainTripleTermIds?.[0]) ids.push(r.mainTripleTermIds[0]);
        for (const sub of r.subReplies ?? []) {
          if (sub.mainTripleTermIds?.[0]) ids.push(sub.mainTripleTermIds[0]);
        }
        return ids;
      });
      if (newIds.length > 0) onNewTripleIds?.(newIds);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.thread}>
      <FeedPost post={post} onBadgeClick={onBadgeClick} onReply={onReply} activeReplyStance={activeReplyMap?.get(post.id) ?? null} sentimentMap={sentimentMap} />
      {composerSlot?.(post.id)}

      {allReplies.length > 0 && (
        <div className={styles.repliesSection}>
          {allReplies.map((r) => (
            <div key={r.id}>
              <ReplyPreview
                reply={r}
                themeSlug={post.themes[0]?.slug ?? ""}
                themes={post.themes}
                onBadgeClick={onBadgeClick}
                onReply={onReply}
                activeReplyStance={activeReplyMap?.get(r.id) ?? null}
                sentimentMap={sentimentMap}
              />
              {composerSlot?.(r.id)}
              {r.subReplies && r.subReplies.length > 0 && (
                <div className={styles.subReplies}>
                  {r.subReplies.map((sub) => (
                    <div key={sub.id}>
                      <ReplyPreview
                        reply={sub}
                        themeSlug={post.themes[0]?.slug ?? ""}
                        themes={post.themes}
                        onBadgeClick={onBadgeClick}
                        onReply={onReply}
                        activeReplyStance={activeReplyMap?.get(sub.id) ?? null}
                        sentimentMap={sentimentMap}
                      />
                      {composerSlot?.(sub.id)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {hasMore && (
            <button
              className={styles.showMore}
              onClick={handleLoadMore}
              disabled={loading}
            >
              {loading ? "Loading..." : `Show ${remaining} more replies`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
