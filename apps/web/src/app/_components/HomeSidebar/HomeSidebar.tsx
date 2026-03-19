"use client";

import Link from "next/link";

import { ThemeBadge } from "@/components/ThemeBadge/ThemeBadge";
import type { ThemeSummary } from "@/app/HomePageClient";
import { WeekVote } from "./WeekVote";
import styles from "./HomeSidebar.module.css";

type HomeSidebarProps = {
  themes: ThemeSummary[];
};

export function HomeSidebar({ themes }: HomeSidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <section className={styles.section}>
        <h3 className={`${styles.title} ${styles.titleCenter}`}>Global Perception</h3>
        <WeekVote />
      </section>

      {themes.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.title}>Themes</h3>
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
