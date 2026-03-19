"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Flame, MessageSquare } from "lucide-react";

import { ThemeBadge } from "@/components/ThemeBadge/ThemeBadge";
import type { TrendingPost } from "@/app/HomePageClient";
import type { SentimentMap } from "@/hooks/useSentimentBatch";
import styles from "./TrendingScroll.module.css";

function truncate(text: string, maxLen: number) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "\u2026";
}

const MIN_PARTICIPANTS = 1;
const MAX_CARDS = 6;

type HotDebatesProps = {
  posts: TrendingPost[];
  sentimentMap: SentimentMap;
};

export function HotDebates({ posts, sentimentMap }: HotDebatesProps) {
  const hotPosts = useMemo(() => {
    return posts
      .filter((p) => {
        if (!p.mainTripleTermId) return false;
        const s = sentimentMap[p.mainTripleTermId];
        return s && s.totalParticipants >= MIN_PARTICIPANTS;
      })
      .sort((a, b) => {
        const sa = sentimentMap[a.mainTripleTermId!]!;
        const sb = sentimentMap[b.mainTripleTermId!]!;
        return Math.abs(sa.supportPct - 50) - Math.abs(sb.supportPct - 50);
      })
      .slice(0, MAX_CARDS);
  }, [posts, sentimentMap]);

  if (hotPosts.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>
        <Flame size={16} />
        Hot Debates
      </h2>
      <div className={styles.scroll}>
        {hotPosts.map((post) => {
          const s = sentimentMap[post.mainTripleTermId!]!;
          const supportPct = Math.round(s.supportPct);
          const opposePct = 100 - supportPct;
          const isHot = s.supportPct >= 45 && s.supportPct <= 55;

          return (
            <Link key={post.id} href={`/posts/${post.id}`} className={styles.card}>
              <div className={styles.themes}>
                {post.themes.slice(0, 2).map((t) => (
                  <ThemeBadge key={t.slug} size="sm" slug={t.slug}>{t.name}</ThemeBadge>
                ))}
              </div>
              <p className={styles.body}>{truncate(post.body, 100)}</p>

              {/* Ratio bar */}
              <div className={styles.ratioBar}>
                <div className={styles.ratioSupport} style={{ width: `${supportPct}%` }} />
                <div className={styles.ratioOppose} />
              </div>
              <div className={styles.ratioPcts}>
                <span className={styles.pctSupport}>{supportPct}%</span>
                <span className={styles.pctOppose}>{opposePct}%</span>
              </div>

              {/* Footer */}
              <span className={styles.replies}>
                {isHot && <Flame size={12} className={styles.hotIcon} />}
                <MessageSquare size={12} />
                {post.replyCount}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
