"use client";

import { useCallback, useMemo, useState } from "react";
import { Sheet } from "@/app/_components/Sheet/Sheet";
import { RightPanel } from "@/app/_components/RightPanel/RightPanel";
import { useIsMobile } from "@/app/_components/RightPanel/useIsMobile";
import { VoteSection } from "@/components/SentimentBar/VoteSection";
import { ConnectedThumbVote } from "@/components/ThumbVote";
import { useSentimentBatch } from "@/hooks/useSentimentBatch";
import { TripleInspector } from "@/components/TripleInspector/TripleInspector";
import { Button } from "@/components/Button/Button";
import { useComposerFlow } from "@/features/post/ExtractionWorkspace/hooks/useComposerFlow";
import { ComposerBlock } from "@/features/post/ExtractionWorkspace/ComposerBlock";
import { useToast } from "@/components/Toast/ToastContext";
import type { ReplyNode } from "@/lib/types/reply";

import { AncestorBreadcrumbs } from "./AncestorBreadcrumbs";
import { FocusCard } from "./FocusCard";
import { RepliesGrid } from "./RepliesGrid";

import styles from "./page.module.css";
import panelStyles from "@/app/_components/RightPanel/PageWithPanel.module.css";

type PostPageClientProps = {
  post: {
    id: string;
    body: string;
    createdAt: string;
    tripleLinks: {
      termId: string;
      role: "MAIN" | "SUPPORTING";
    }[];
  };
  theme: {
    slug: string;
    name: string;
  };
  breadcrumbs: {
    id: string;
    body: string;
  }[];
  replies: ReplyNode[];
};

export function PostPageClient({ post, theme, breadcrumbs, replies }: PostPageClientProps) {
  const { addToast } = useToast();
  const isMobile = useIsMobile();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTriples, setInspectorTriples] = useState(post.tripleLinks);
  const [voteRefreshKey, setVoteRefreshKey] = useState(0);

  const handleVoteSuccess = useCallback(() => {
    setVoteRefreshKey((k) => k + 1);
  }, []);

  const parentMainTripleTermId = post.tripleLinks.find(t => t.role === "MAIN")?.termId ?? null;

  const composerFlow = useComposerFlow({
    themeSlug: theme.slug,
    parentPostId: post.id,
    parentMainTripleTermId,
    themeTitle: theme.name,
    parentClaim: post.body,
    onPublishSuccess: (postId) => {
      addToast("Reply created", "success", { label: "See", href: `/posts/${postId}` }, 6000);
    },
  });

  // Batch fetch sentiment data for reply sentiment indicators
  const replyTripleIds = useMemo(() =>
    replies.flatMap(r => r.mainTripleTermIds?.[0] ? [r.mainTripleTermIds[0]] : []),
    [replies],
  );
  const { data: sentimentMap } = useSentimentBatch(replyTripleIds);

  function handleReplyClick() {
    setInspectorOpen(false);
    composerFlow.openComposer();
  }

  function handleOpenInspector() {
    setInspectorTriples(post.tripleLinks);
    composerFlow.closeComposer();
    setInspectorOpen(true);
  }

  function handleReplyBadgeClick(tripleTermIds: string[], _postId: string) {
    setInspectorTriples(tripleTermIds.map(id => ({ termId: id, role: "MAIN" as const })));
    composerFlow.closeComposer();
    setInspectorOpen(true);
  }

  const supportReplies = replies.filter((r) => r.stance?.toUpperCase() === "SUPPORTS");
  const refuteReplies = replies.filter((r) => r.stance?.toUpperCase() === "REFUTES");

  const treeReplies = useMemo(
    () => [
      ...supportReplies.map((r) => ({ id: r.id, body: r.body, stance: "SUPPORTS" as const })),
      ...refuteReplies.map((r) => ({ id: r.id, body: r.body, stance: "REFUTES" as const })),
    ],
    [supportReplies, refuteReplies],
  );

  const miniTreeData = useMemo(() => ({
    breadcrumbs,
    focusNode: { id: post.id, body: post.body },
    replies: treeReplies,
  }), [breadcrumbs, post.id, post.body, treeReplies]);

  const inspectorKey = inspectorTriples.map(t => t.termId).join(",");
  const inspectorContent = inspectorTriples.length > 0 ? (
    <TripleInspector
      key={inspectorKey}
      triples={inspectorTriples}
      defaultTripleTermId={inspectorTriples[0]?.termId ?? null}
      currentPostId={post.id}
      miniTreeData={miniTreeData}
    />
  ) : null;

  return (
    <div className={`${panelStyles.wrapper} ${inspectorOpen ? panelStyles.wrapperOpen : ""}`}>
      <div className={panelStyles.content}>
        <div className={styles.page}>
          <AncestorBreadcrumbs breadcrumbs={breadcrumbs} />

          <FocusCard
            post={post}
            themeName={theme.name}
            onOpenInspector={handleOpenInspector}
            thumbSlot={parentMainTripleTermId ? (
              <ConnectedThumbVote tripleTermId={parentMainTripleTermId} size="md" onVoteSuccess={handleVoteSuccess} />
            ) : undefined}
          >
            {parentMainTripleTermId && (
              <VoteSection tripleTermId={parentMainTripleTermId} refreshKey={voteRefreshKey} />
            )}
          </FocusCard>

          {!composerFlow.composerOpen && (
            <div className={styles.replyAction}>
              <Button variant="secondary" size="sm" onClick={handleReplyClick}>
                Reply
              </Button>
            </div>
          )}

          <ComposerBlock composerFlow={composerFlow} />

          <RepliesGrid
            supportReplies={supportReplies}
            refuteReplies={refuteReplies}
            onBadgeClick={handleReplyBadgeClick}
            sentimentMap={sentimentMap}
          />
        </div>
      </div>

      {/* Right panel (desktop) — Inspector only */}
      {!isMobile && (
        <div className={panelStyles.panelSlot}>
          {inspectorOpen && inspectorTriples.length > 0 && (
            <RightPanel
              open
              title="Protocol Inspector"
              onClose={() => setInspectorOpen(false)}
            >
              {inspectorContent}
            </RightPanel>
          )}
        </div>
      )}

      {/* Mobile: Sheet for Inspector */}
      {isMobile && (
        <Sheet
          open={inspectorOpen && inspectorTriples.length > 0}
          onOpenChange={setInspectorOpen}
          title="Protocol Inspector"
        >
          {inspectorContent}
        </Sheet>
      )}
    </div>
  );
}
