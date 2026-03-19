import Link from "next/link";
import { CornerDownRight } from "lucide-react";
import { ReplyCard } from "@/app/_components/ReplyCard/ReplyCard";
import type { FeedPostData } from "@/app/HomePageClient";
import type { SentimentMap } from "@/hooks/useSentimentBatch";
import type { ReplyTarget } from "./FeedThread";
import styles from "./FeedPost.module.css";

type FeedPostProps = {
  post: FeedPostData;
  onBadgeClick?: (tripleTermIds: string[], postId: string) => void;
  onReply?: (target: ReplyTarget) => void;
  activeReplyStance?: "SUPPORTS" | "REFUTES" | null;
  sentimentMap?: SentimentMap;
};

export function FeedPost({ post, onBadgeClick, onReply, activeReplyStance, sentimentMap }: FeedPostProps) {
  const mainTripleTermId = post.mainTripleTermIds?.[0] ?? undefined;
  const sentiment = mainTripleTermId ? sentimentMap?.[mainTripleTermId] ?? null : null;

  return (
    <>
      {post.parentContext && (
        <Link href={`/posts/${post.parentContext.id}`} className={styles.parentContext}>
          <CornerDownRight size={12} className={styles.parentContextIcon} />
          <span className={styles.parentContextText}>
            reply to {post.parentContext.bodyExcerpt}
          </span>
        </Link>
      )}
      <ReplyCard
        id={post.id}
        body={post.body}
        createdAt={post.createdAt}
        replyCount={post.replyCount}
        author={post.user}
        stance={post.stance}
        themes={post.themes}
        variant="compact"
        mainTripleTermId={mainTripleTermId}
        mainTripleTermIds={post.mainTripleTermIds}
        sentimentData={sentiment}
        onBadgeClick={onBadgeClick}
        onReply={onReply ? (stance) => onReply({ postId: post.id, themeSlug: post.themes[0]?.slug ?? "", themes: post.themes, mainTripleTermId: mainTripleTermId ?? null, stance }) : undefined}
        activeReplyStance={activeReplyStance}
        showBorder={!!post.stance}
      />
    </>
  );
}
