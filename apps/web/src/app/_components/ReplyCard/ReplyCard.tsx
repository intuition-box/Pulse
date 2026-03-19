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

type ThemeItem = { slug: string; name: string };

export type ReplyCardProps = {
  id: string;
  body: string;
  createdAt: string;
  replyCount: number;
  mainTripleTermId?: string;
  author?: Author;
  stance?: "SUPPORTS" | "REFUTES" | null;
  themes?: ThemeItem[];
  variant?: "compact" | "default";
  sentimentData?: SentimentData | null;
  onBadgeClick?: (tripleTermIds: string[], postId: string) => void;
  mainTripleTermIds?: string[];
  onReply?: (stance: "SUPPORTS" | "REFUTES") => void;
  /** When set, reply buttons stay visible with the active one highlighted. */
  activeReplyStance?: "SUPPORTS" | "REFUTES" | null;
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
  themes,
  variant = "default",
  sentimentData,
  onBadgeClick,
  mainTripleTermIds,
  onReply,
  activeReplyStance,
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
          {((themes && themes.length > 0) || (mainTripleTermId && sentimentData)) && (
            <div className={styles.headerRight}>
              {variant === "compact" && themes && themes.length > 0 && (
                <>
                  {themes.slice(0, 2).map((t) => (
                    <ThemeBadge key={t.slug} size="sm" slug={t.slug}>{t.name}</ThemeBadge>
                  ))}
                  {themes.length > 2 && (
                    <span className={styles.moreThemes}>+{themes.length - 2}</span>
                  )}
                </>
              )}
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
        <div className={`${styles.countReplyZone} ${onReply ? styles.hasSwap : ""} ${activeReplyStance ? styles.swapLocked : ""}`}>
          <span className={styles.replyCount}>
            <MessageSquare size={12} />
            {replyCount}
          </span>
          {onReply && (
            <div className={styles.replyBtns}>
              <button
                type="button"
                className={`${styles.replyBtn} ${styles.replyBtnSupport} ${activeReplyStance === "SUPPORTS" ? styles.replyBtnActive : ""}`}
                onClick={() => onReply("SUPPORTS")}
                aria-label="Support this post"
              >
                Support
              </button>
              <button
                type="button"
                className={`${styles.replyBtn} ${styles.replyBtnRefute} ${activeReplyStance === "REFUTES" ? styles.replyBtnActive : ""}`}
                onClick={() => onReply("REFUTES")}
                aria-label="Refute this post"
              >
                Refute
              </button>
            </div>
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
