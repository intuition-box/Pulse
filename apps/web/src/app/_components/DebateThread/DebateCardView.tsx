"use client";

import Link from "next/link";
import { MessageSquare, Network } from "lucide-react";

import { Avatar } from "@/components/Avatar/Avatar";
import { Chip } from "@/components/Chip/Chip";
import { ThemeBadge } from "@/components/ThemeBadge/ThemeBadge";
import { ConnectedThumbVote } from "@/components/ThumbVote";
import { SentimentCircle } from "@/components/SentimentBar/SentimentCircle";
import type { SentimentData } from "@/hooks/useSentimentBatch";
import { authorLabel } from "@/lib/format/author";
import { formatPostDate } from "../FeedPost/helpers";

import styles from "./DebateCardView.module.css";

export type DebatePostData = {
  id: string;
  body: string;
  createdAt: string;
  user: { displayName: string | null; address: string; avatar: string | null };
  replyCount: number;
  stance?: "SUPPORTS" | "REFUTES" | null;
  themes?: { slug: string; name: string }[];
  mainTripleTermIds?: string[];
  latestRepliers?: { avatar: string | null; name: string; address: string }[];
};

export type DebateCardViewProps = {
  post: DebatePostData;
  stance?: "SUPPORTS" | "REFUTES" | null;
  sentimentData?: SentimentData | null;
  onBadgeClick?: (tripleTermIds: string[], postId: string) => void;
  onReply?: (stance: "SUPPORTS" | "REFUTES") => void;
  activeReplyStance?: "SUPPORTS" | "REFUTES" | null;
  linkTarget?: string;
  dense?: boolean;
};

export function DebateCardView({
  post,
  stance,
  sentimentData,
  onBadgeClick,
  onReply,
  activeReplyStance,
  linkTarget,
  dense = false,
}: DebateCardViewProps) {
  const mainTripleTermId = post.mainTripleTermIds?.[0];

  const stanceClass =
    stance === "SUPPORTS" ? styles.cardSupports :
    stance === "REFUTES" ? styles.cardRefutes :
    styles.cardNeutral;

  const cardClasses = [
    styles.card,
    stanceClass,
    dense ? styles.dense : "",
  ].filter(Boolean).join(" ");

  return (
    <article className={cardClasses}>
      <Link
        href={`/posts/${post.id}`}
        className={styles.mainLink}
        target={linkTarget}
        rel={linkTarget === "_blank" ? "noopener noreferrer" : undefined}
      >
        <header className={styles.header}>
          <Avatar src={post.user.avatar} name={authorLabel(post.user)} size="sm" />
          <cite className={styles.author}>{authorLabel(post.user)}</cite>
          <time className={styles.time} dateTime={post.createdAt} suppressHydrationWarning>
            {formatPostDate(post.createdAt)}
          </time>
          {post.themes && post.themes[0] && (
            <span className={styles.themeBadge}>
              <ThemeBadge size="sm" slug={post.themes[0].slug}>
                {post.themes[0].name}
              </ThemeBadge>
            </span>
          )}
        </header>
        <p className={styles.body}>{post.body}</p>
      </Link>

      <footer className={styles.actions}>
        {sentimentData && (
          <span className={styles.footerSentiment}>
            <SentimentCircle
              supportPct={sentimentData.supportPct}
              totalParticipants={sentimentData.totalParticipants}
              mode="tiny"
            />
            <span className={styles.sentimentPct}>
              {Math.round(sentimentData.supportPct)}%
            </span>
          </span>
        )}
        {mainTripleTermId && (
          <span className={styles.thumbSlot}>
            <ConnectedThumbVote
              tripleTermId={mainTripleTermId}
              sentimentData={sentimentData ?? null}
              size="sm"
              variant="inline"
            />
          </span>
        )}
        {post.replyCount > 0 && (
          <span
            className={[
              styles.replyCount,
              post.latestRepliers && post.latestRepliers.length > 0 ? styles.withRepliers : "",
            ].filter(Boolean).join(" ")}
          >
            {post.latestRepliers && post.latestRepliers.length > 0 ? (
              <span className={styles.replierStack} aria-hidden="true">
                {post.latestRepliers.slice(0, 3).map((r) => (
                  <span key={r.address} className={styles.replierChip} title={r.name}>
                    <Avatar src={r.avatar} name={r.name} size="xs" shape="circular" />
                  </span>
                ))}
              </span>
            ) : (
              <MessageSquare size={12} />
            )}
            <span className={styles.replyCountText}>
              {post.replyCount} <span className={styles.replyLabel}>{post.replyCount === 1 ? "reply" : "replies"}</span>
            </span>
          </span>
        )}

        <span className={styles.actionsRight}>
          {onReply && (
            <>
              <Chip
                tone="supports"
                size="md"
                active={activeReplyStance === "SUPPORTS"}
                onClick={() => onReply("SUPPORTS")}
                aria-label="Support this post"
              >
                Support
              </Chip>
              <Chip
                tone="refutes"
                size="md"
                active={activeReplyStance === "REFUTES"}
                onClick={() => onReply("REFUTES")}
                aria-label="Refute this post"
              >
                Refute
              </Chip>
            </>
          )}
          {post.mainTripleTermIds && post.mainTripleTermIds.length > 0 && onBadgeClick && (
            <button
              type="button"
              className={styles.structureBtn}
              onClick={() => onBadgeClick(post.mainTripleTermIds!, post.id)}
              aria-label="View structure"
            >
              <Network size={12} />
            </button>
          )}
        </span>
      </footer>
    </article>
  );
}
