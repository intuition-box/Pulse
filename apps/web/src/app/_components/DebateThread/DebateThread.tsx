"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import type { SentimentMap } from "@/hooks/useSentimentBatch";
import type { FeedPostData, FeedReplyPreview, LoadMoreRepliesFn } from "@/app/HomePageClient";

import { DebateCardView, type DebatePostData } from "./DebateCardView";
import styles from "./DebateThread.module.css";

type ReplierUser = { displayName: string | null; address: string; avatar: string | null };

function dedupeByAddress(users: ReplierUser[]): ReplierUser[] {
  const seen = new Set<string>();
  const out: ReplierUser[] = [];
  for (const u of users) {
    if (seen.has(u.address)) continue;
    seen.add(u.address);
    out.push(u);
  }
  return out;
}

export type ReplyTarget = {
  postId: string;
  themeSlug: string;
  themes: { slug: string; name: string }[];
  mainTripleTermId: string | null;
  stance: "SUPPORTS" | "REFUTES";
};

type DebateThreadProps = {
  post: FeedPostData;
  onBadgeClick?: (tripleTermIds: string[], postId: string) => void;
  onReply?: (target: ReplyTarget) => void;
  activeReplyMap?: Map<string, "SUPPORTS" | "REFUTES">;
  composerSlot?: (postId: string) => ReactNode;
  sentimentMap?: SentimentMap;
  loadMoreReplies?: LoadMoreRepliesFn;
  onNewTripleIds?: (ids: string[]) => void;
};

export function DebateThread({
  post,
  onBadgeClick,
  onReply,
  activeReplyMap,
  composerSlot,
  sentimentMap,
  loadMoreReplies,
  onNewTripleIds,
}: DebateThreadProps) {
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

  function makeReplyHandler(replyId: string, replyTripleTermId: string | null) {
    return onReply
      ? (stance: "SUPPORTS" | "REFUTES") => onReply({
          postId: replyId,
          themeSlug: post.themes[0]?.slug ?? "",
          themes: post.themes,
          mainTripleTermId: replyTripleTermId,
          stance,
        })
      : undefined;
  }

  function getSentiment(termId: string | null | undefined) {
    if (!termId) return null;
    return sentimentMap?.[termId] ?? null;
  }

  const rootTripleId = post.mainTripleTermIds?.[0] ?? null;
  const hasReplies = allReplies.length > 0;

  const rootLatestRepliers = dedupeByAddress(allReplies.map((r) => r.user))
    .slice(0, 3)
    .map((u) => ({
      avatar: u.avatar,
      name: u.displayName ?? u.address,
      address: u.address,
    }));

  return (
    <div className={styles.thread}>
      <DebateCardView
        post={{ ...post, latestRepliers: rootLatestRepliers }}
        sentimentData={getSentiment(rootTripleId)}
        onBadgeClick={onBadgeClick}
        onReply={
          onReply
            ? (stance) =>
                onReply({
                  postId: post.id,
                  themeSlug: post.themes[0]?.slug ?? "",
                  themes: post.themes,
                  mainTripleTermId: rootTripleId,
                  stance,
                })
            : undefined
        }
        activeReplyStance={activeReplyMap?.get(post.id) ?? null}
      />

      {composerSlot?.(post.id) != null && (
        <div className={`${styles.replyWrap} ${styles.composerReplyWrap}`} data-last="true">
          <div className={styles.composerSlot}>{composerSlot(post.id)}</div>
        </div>
      )}

      {hasReplies && (
        <ol className={styles.repliesZone}>
          {allReplies.map((reply, idx) => {
            const replyTripleTermId = reply.mainTripleTermIds?.[0] ?? null;
            const isLastReply = idx === allReplies.length - 1 && !hasMore;

            const replyPostData: DebatePostData = {
              id: reply.id,
              body: reply.body,
              createdAt: reply.createdAt,
              user: reply.user,
              replyCount: reply.replyCount,
              stance: reply.stance,
              mainTripleTermIds: reply.mainTripleTermIds,
              themes: post.themes,
              latestRepliers: dedupeByAddress((reply.subReplies ?? []).map((s) => s.user))
                .slice(0, 3)
                .map((u) => ({
                  avatar: u.avatar,
                  name: u.displayName ?? u.address,
                  address: u.address,
                })),
            };

            return (
              <li
                key={reply.id}
                className={styles.replyWrap}
                data-last={isLastReply ? "true" : "false"}
              >
                <DebateCardView
                  post={replyPostData}
                  stance={reply.stance ?? null}
                  sentimentData={getSentiment(replyTripleTermId)}
                  onBadgeClick={onBadgeClick}
                  onReply={makeReplyHandler(reply.id, replyTripleTermId)}
                  activeReplyStance={activeReplyMap?.get(reply.id) ?? null}
                />

                {composerSlot?.(reply.id) != null && (
                  <div className={styles.composerSlot}>{composerSlot(reply.id)}</div>
                )}

                {reply.subReplies && reply.subReplies.length > 0 && (
                  <ol className={styles.subRepliesZone}>
                    {reply.subReplies.map((sub, subIdx) => {
                      const subTripleTermId = sub.mainTripleTermIds?.[0] ?? null;
                      const isLastSub = subIdx === (reply.subReplies?.length ?? 0) - 1;

                      const subPostData: DebatePostData = {
                        id: sub.id,
                        body: sub.body,
                        createdAt: sub.createdAt,
                        user: sub.user,
                        replyCount: sub.replyCount,
                        stance: sub.stance,
                        mainTripleTermIds: sub.mainTripleTermIds,
                        themes: post.themes,
                      };

                      return (
                        <li
                          key={sub.id}
                          className={styles.replyWrap}
                          data-last={isLastSub ? "true" : "false"}
                        >
                          <DebateCardView
                            post={subPostData}
                            stance={sub.stance ?? null}
                            sentimentData={getSentiment(subTripleTermId)}
                            onBadgeClick={onBadgeClick}
                            onReply={makeReplyHandler(sub.id, subTripleTermId)}
                            activeReplyStance={activeReplyMap?.get(sub.id) ?? null}
                          />
                          {composerSlot?.(sub.id) != null && (
                            <div className={styles.composerSlot}>{composerSlot(sub.id)}</div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {hasReplies && hasMore && (
        <button
          className={styles.showMore}
          onClick={handleLoadMore}
          disabled={loading}
        >
          {loading ? "Loading..." : `Show ${remaining} more ${remaining === 1 ? "reply" : "replies"}`}
        </button>
      )}
    </div>
  );
}
