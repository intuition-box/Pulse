"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/Button/Button";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { ProtocolBadge } from "@/components/ProtocolBadge/ProtocolBadge";
import { useComposerFlow } from "@/features/post/ExtractionWorkspace/hooks/useComposerFlow";
import { ComposerBlock } from "@/features/post/ExtractionWorkspace/ComposerBlock";
import { useToast } from "@/components/Toast/ToastContext";
import { TripleTooltip } from "@/components/TripleTooltip/TripleTooltip";

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
    mainTripleTermIds: string[];
  }[];
};

export function ThemePageClient({ theme, rootPosts }: ThemePageClientProps) {
  const { addToast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");

  const composerFlow = useComposerFlow({
    themeSlug: theme.slug,
    parentPostId: null,
    themeAtomTermId: theme.atomTermId,
    themeTitle: theme.name,
    onPublishSuccess: (postId) => {
      addToast("Debate created", "success", { label: "See", href: `/posts/${postId}` }, 6000);
    },
  });

  const filteredPosts = useMemo(() => {
    if (!searchQuery.trim()) return rootPosts;
    const q = searchQuery.toLowerCase();
    return rootPosts.filter((p) => p.body.toLowerCase().includes(q));
  }, [rootPosts, searchQuery]);

  return (
    <div className={styles.page}>
      {/* Header */}
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

      {/* Composer inline */}
      <ComposerBlock composerFlow={composerFlow} className={styles.composerSection} placeholder="Start a debate" />

      {/* Posts grid */}
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
          <div className={styles.postsGrid}>
            {filteredPosts.map((post) => (
              <Link key={post.id} href={`/posts/${post.id}`} className={styles.postCard}>
                <p className={styles.postBody}>{post.body}</p>
                <div className={styles.postFooter}>
                  <span className={styles.postReplies}>
                    <MessageSquare size={12} style={{ verticalAlign: "-1px", marginRight: "3px" }} />
                    {post.replyCount}
                  </span>
                  <span className={styles.postDate}>
                    {new Date(post.createdAt).toLocaleDateString()}
                  </span>
                  {post.mainTripleTermIds.length > 0 && (
                    <TripleTooltip tripleTermIds={post.mainTripleTermIds}>
                      <ProtocolBadge>⛓</ProtocolBadge>
                    </TripleTooltip>
                  )}
                  <span className={styles.openThread}>Open →</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
