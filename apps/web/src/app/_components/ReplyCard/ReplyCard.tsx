import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Avatar } from "@/components/Avatar/Avatar";
import { ProtocolBadge } from "@/components/ProtocolBadge/ProtocolBadge";
import { TripleTooltip } from "@/components/TripleTooltip/TripleTooltip";
import { SentimentCircle } from "@/components/SentimentBar/SentimentCircle";
import { ThemeBadge } from "@/components/ThemeBadge/ThemeBadge";
import { ConnectedThumbVote } from "@/components/ThumbVote";
import type { SentimentData } from "@/hooks/useSentimentBatch";
import { authorLabel } from "@/lib/format/author";
import type { Author } from "@/lib/types/reply";
import { formatRelativeTime } from "../FeedPost/helpers";
import styles from "./ReplyCard.module.css";

export type ReplyCardProps = {
  id: string;
  body: string;
  createdAt: string;
  replyCount: number;
  mainTripleTermId?: string;
  author?: Author;
  stance?: "SUPPORTS" | "REFUTES" | null;
  themeName?: string;
  variant?: "compact" | "default";
  sentimentData?: SentimentData | null;
  onBadgeClick?: (tripleTermIds: string[], postId: string) => void;
  mainTripleTermIds?: string[];
  onReply?: () => void;
  showBorder?: boolean;
};

export function ReplyCard({
  id,
  body,
  createdAt,
  replyCount,
  mainTripleTermId,
  author,
  stance,
  themeName,
  variant = "default",
  sentimentData,
  onBadgeClick,
  mainTripleTermIds,
  onReply,
  showBorder = true,
}: ReplyCardProps) {
  const stanceClass =
    stance === "SUPPORTS" ? styles.stanceSupports :
    stance === "REFUTES" ? styles.stanceRefutes : "";

  return (
    <div className={`${styles.card} ${stanceClass} ${showBorder ? "" : styles.noBorder}`}>
      <Link href={`/posts/${id}`} className={styles.link}>
        <div className={styles.header}>
          <Avatar src={author?.avatar} name={authorLabel(author)} size="sm" />
          <span className={styles.author}>{authorLabel(author)}</span>
          {variant === "compact" && (
            <span className={styles.time}>{formatRelativeTime(createdAt)}</span>
          )}
          {(themeName || (mainTripleTermId && sentimentData)) && (
            <div className={styles.headerRight}>
              {variant === "compact" && themeName && <ThemeBadge size="sm">{themeName}</ThemeBadge>}
              {mainTripleTermId && sentimentData && (
                <SentimentCircle
                  supportPct={sentimentData.supportPct}
                  totalParticipants={sentimentData.totalParticipants}
                  mode="compact"
                />
              )}
            </div>
          )}
        </div>
        <p className={variant === "compact" ? styles.bodyCompact : styles.body}>{body}</p>
      </Link>
      <div className={styles.actions}>
        <div className={`${styles.countReplyZone} ${onReply ? styles.hasSwap : ""}`}>
          <span className={styles.replyCount}>
            <MessageSquare size={12} />
            {replyCount}
          </span>
          {onReply && (
            <button
              type="button"
              className={styles.replyBtn}
              onClick={onReply}
              aria-label="Reply to this post"
            >
              <MessageSquare size={12} />
              Reply
            </button>
          )}
        </div>
        {mainTripleTermIds && mainTripleTermIds.length > 0 && (
          <TripleTooltip tripleTermIds={mainTripleTermIds}>
            <ProtocolBadge onClick={() => onBadgeClick?.(mainTripleTermIds, id)}>
              ⛓
            </ProtocolBadge>
          </TripleTooltip>
        )}
        {mainTripleTermId && (
          <span className={styles.thumbRight}>
            <ConnectedThumbVote
              tripleTermId={mainTripleTermId}
              sentimentData={sentimentData ?? null}
              size="sm"
            />
          </span>
        )}
      </div>
    </div>
  );
}
