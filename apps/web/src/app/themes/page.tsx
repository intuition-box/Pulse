import Link from "next/link";

import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

import { ThemesPageClient } from "./ThemesPageClient";

import styles from "./page.module.css";

export default async function ThemesIndexPage() {
  const themes = await prisma.theme.findMany({
    orderBy: { name: "asc" },
  });

  // Count only root posts (not replies) per theme — aligned with /api/themes
  const rootCounts = await prisma.postTheme.groupBy({
    by: ["themeSlug"],
    where: { post: { parentPostId: null } },
    _count: { postId: true },
  });
  const rootCountMap = new Map(rootCounts.map(r => [r.themeSlug, r._count.postId]));

  return (
    <div className={styles.page}>
      <section className={styles.header}>
        <div className={styles.headerTop}>
          <div>
            <h1 className={styles.title}>Themes</h1>
            <p className={styles.subtitle}>Browse all debate themes</p>
          </div>
          <ThemesPageClient />
        </div>
      </section>

      {themes.length === 0 ? (
        <p className={styles.empty}>No themes yet.</p>
      ) : (
        <div className={styles.grid}>
          {themes.map((theme) => (
            <Link
              key={theme.slug}
              href={`/themes/${theme.slug}`}
              className={styles.themeCard}
            >
              <h2 className={styles.themeTitle}>{theme.name}</h2>
              <span className={styles.themeCount}>
                {rootCountMap.get(theme.slug) ?? 0} {(rootCountMap.get(theme.slug) ?? 0) === 1 ? "debate" : "debates"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
