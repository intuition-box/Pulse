"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/Button/Button";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { useComposerFlow } from "@/features/post/ExtractionWorkspace/hooks/useComposerFlow";
import { ComposerBlock } from "@/features/post/ExtractionWorkspace/ComposerBlock";
import { useToast } from "@/components/Toast/ToastContext";
import { DebateCardView, type DebatePostData } from "@/app/_components/DebateThread/DebateCardView";
import { useSentimentBatch } from "@/hooks/useSentimentBatch";
import styles from "./page.module.css";

type ThemePageClientProps = {
  theme: {
    slug: string;
    name: string;
    atomTermId: string | null;
  };
  rootPosts: {
    id: string;
    body: string;
    createdAt: string;
    replyCount: number;
    user: { displayName: string | null; address: string; avatar: string | null };
    themes: { slug: string; name: string }[];
    mainTripleTermIds: string[];
  }[];
};

export function ThemePageClient({ theme, rootPosts }: ThemePageClientProps) {
  const { addToast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");

  const composerFlow = useComposerFlow({
    themes: [{ slug: theme.slug, name: theme.name }],
    parentPostId: null,
    onPublishSuccess: (postId) => {
      addToast("Debate created", "success", { label: "See", href: `/posts/${postId}` }, 6000);
    },
  });

  const filteredPosts = useMemo(() => {
    if (!searchQuery.trim()) return rootPosts;
    const q = searchQuery.toLowerCase();
    return rootPosts.filter((p) => p.body.toLowerCase().includes(q));
  }, [rootPosts, searchQuery]);

  const tripleIds = useMemo(
    () => filteredPosts.flatMap((p) => (p.mainTripleTermIds[0] ? [p.mainTripleTermIds[0]] : [])),
    [filteredPosts],
  );
  const { data: sentimentMap } = useSentimentBatch(tripleIds);

  return (
    <div className={styles.page}>
      <section className={styles.header}>
        <div className={styles.headerTop}>
          <div>
            <p className={styles.kicker}>Theme</p>
            <h1 className={styles.title}>{theme.name}</h1>
          </div>
          {composerFlow.flow.walletConnected && (
            <Button variant="primary" onClick={() => composerFlow.openComposer()}>
              New debate
            </Button>
          )}
        </div>

        <div className={styles.searchBar}>
          <input
            type="search"
            placeholder="Search debates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
            aria-label="Search debates"
          />
        </div>
      </section>

      <ComposerBlock composerFlow={composerFlow} className={styles.composerSection} placeholder="Drop a claim worth debating…" />

      <section className={styles.postsSection}>
        {filteredPosts.length === 0 ? (
          <EmptyState
            title={searchQuery ? "No debates match your search." : "No debates yet in this theme."}
            action={
              !searchQuery && composerFlow.flow.walletConnected ? (
                <Button variant="secondary" onClick={() => composerFlow.openComposer()}>
                  Create first debate
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className={styles.postsList}>
            {filteredPosts.map((post) => {
              const tripleId = post.mainTripleTermIds[0];
              const sentimentData = tripleId ? sentimentMap?.[tripleId] ?? null : null;
              const postData: DebatePostData = {
                id: post.id,
                body: post.body,
                createdAt: post.createdAt,
                user: post.user,
                replyCount: post.replyCount,
                themes: post.themes,
                mainTripleTermIds: post.mainTripleTermIds,
              };
              return (
                <DebateCardView
                  key={post.id}
                  post={postData}
                  sentimentData={sentimentData}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
