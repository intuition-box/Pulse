"use client";

import Link from "next/link";
import { MessageSquare, Network } from "lucide-react";

import { Avatar } from "@/components/Avatar/Avatar";
import { UserPopover } from "@/components/UserPopover/UserPopover";
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
  threadPosition?: "solo" | "root" | "reply" | "replyLast";
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
  threadPosition = "solo",
}: DebateCardViewProps) {
  const mainTripleTermId = post.mainTripleTermIds?.[0];

  const stanceClass =
    stance === "SUPPORTS" ? styles.cardSupports :
    stance === "REFUTES" ? styles.cardRefutes :
    styles.cardNeutral;

  const positionClass =
    threadPosition === "root" ? styles.posRoot :
    threadPosition === "reply" ? styles.posReply :
    threadPosition === "replyLast" ? styles.posReplyLast :
    styles.posSolo;

  const cardClasses = [
    styles.card,
    stanceClass,
    positionClass,
    dense ? styles.dense : "",
  ].filter(Boolean).join(" ");

  return (
    <article className={cardClasses}>
      <div className={styles.main}>
        <Link
          href={`/posts/${post.id}`}
          className={styles.mainLink}
          aria-label={`Open post by ${authorLabel(post.user)}`}
          target={linkTarget}
          rel={linkTarget === "_blank" ? "noopener noreferrer" : undefined}
        />
        <header className={styles.header}>
          <UserPopover address={post.user.address}>
            <button type="button" className={styles.authorTrigger}>
              <Avatar src={post.user.avatar} name={authorLabel(post.user)} size="sm" />
              <span className={styles.author}>{authorLabel(post.user)}</span>
            </button>
          </UserPopover>
          <span className={styles.time} suppressHydrationWarning>
            {formatPostDate(post.createdAt)}
          </span>
          {post.themes && post.themes[0] && (
            <span className={styles.themeBadge}>
              <ThemeBadge size="sm" slug={post.themes[0].slug}>
                {post.themes[0].name}
              </ThemeBadge>
            </span>
          )}
          {sentimentData && (
            <span className={styles.headerSentiment}>
              <SentimentCircle
                supportPct={sentimentData.supportPct}
                totalParticipants={sentimentData.totalParticipants}
                mode={dense ? "micro" : "compact"}
              />
            </span>
          )}
        </header>
        <p className={styles.body}>{post.body}</p>
      </div>

      <div className={styles.actions}>
        <div className={`${styles.countReplyZone} ${onReply ? styles.hasSwap : ""} ${activeReplyStance ? styles.swapLocked : ""}`}>
          <span className={`${styles.replyCount} ${post.replyCount > 0 ? styles.hasReplies : ""}`}>
            <MessageSquare size={12} />
            {post.replyCount} {post.replyCount === 1 ? "reply" : "replies"}
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
        {mainTripleTermId && (
          <span className={styles.thumbRight}>
            <ConnectedThumbVote
              tripleTermId={mainTripleTermId}
              sentimentData={sentimentData ?? null}
              size="sm"
            />
          </span>
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
      </div>
    </article>
  );
}
