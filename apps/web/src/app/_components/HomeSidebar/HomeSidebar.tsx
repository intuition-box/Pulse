"use client";

import Link from "next/link";

import { ThemeBadge } from "@/components/ThemeBadge/ThemeBadge";
import { Label } from "@/components/Label/Label";
import { SearchBar } from "@/components/SearchBar/SearchBar";
import type { ThemeSummary, TrendingPost } from "@/app/HomePageClient";
import type { SentimentMap } from "@/hooks/useSentimentBatch";
import { HotDebates } from "@/app/_components/TrendingScroll/TrendingScroll";
import { WeekVote } from "./WeekVote";
import { RankingWidget } from "./RankingWidget";
import { FEATURED_RANKING } from "@/lib/rankings";
import styles from "./HomeSidebar.module.css";

type HomeSidebarProps = {
  themes: ThemeSummary[];
  trending?: TrendingPost[];
  sentimentMap?: SentimentMap;
};

export function HomeSidebar({ themes, trending = [], sentimentMap = {} }: HomeSidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <SearchBar />

      {trending.length > 0 && (
        <HotDebates posts={trending} sentimentMap={sentimentMap} variant="compact" />
      )}

      <section className={styles.section}>
        <Label size="sm" as="h3" className={styles.titleCenter}>Global Perception</Label>
        <WeekVote />
      </section>

      <RankingWidget config={FEATURED_RANKING} />

      {themes.length > 0 && (
        <section className={styles.section}>
          <Label size="sm" as="h3" className={styles.sectionTitle}>Themes</Label>
          <div className={styles.categoriesList}>
            {themes.map((cat) => (
              <Link key={cat.slug} href={`/themes/${cat.slug}`} className={styles.categoryLink}>
                <ThemeBadge size="sm" slug={cat.slug}>{cat.name}</ThemeBadge>
              </Link>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}
