"use client";

import { useCallback, useMemo, useState } from "react";
import { Sheet } from "@/app/_components/Sheet/Sheet";
import { RightPanel } from "@/app/_components/RightPanel/RightPanel";
import { useIsMobile } from "@/app/_components/RightPanel/useIsMobile";
import { VoteSection } from "@/components/SentimentBar/VoteSection";
import { ConnectedThumbVote } from "@/components/ThumbVote";
import { useSentimentBatch } from "@/hooks/useSentimentBatch";
import { TripleInspector } from "@/components/TripleInspector/TripleInspector";
import { useComposerFlow } from "@/features/post/ExtractionWorkspace/hooks/useComposerFlow";
import { ComposerBlock } from "@/features/post/ExtractionWorkspace/ComposerBlock";
import { labels } from "@/lib/vocabulary";
import { ThemeRow } from "@/components/ThemeSelector/ThemeRow";
import { useToast } from "@/components/Toast/ToastContext";
import { useCreateTheme } from "@/features/theme/useCreateTheme";
import { useAddPostTheme } from "@/features/theme/useAddPostTheme";
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
    stance: "SUPPORTS" | "REFUTES" | null;
    tripleLinks: {
      termId: string;
      role: "MAIN" | "SUPPORTING";
    }[];
  };
  themes: {
    slug: string;
    name: string;
  }[];
  breadcrumbs: {
    id: string;
    body: string;
  }[];
  replies: ReplyNode[];
};

export function PostPageClient({ post, themes: initialThemes, breadcrumbs, replies }: PostPageClientProps) {
  const { addToast } = useToast();
  const isMobile = useIsMobile();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTriples, setInspectorTriples] = useState(post.tripleLinks);
  const [voteRefreshKey, setVoteRefreshKey] = useState(0);
  const [themes, setThemes] = useState(initialThemes);
  const [replyThemes, setReplyThemes] = useState(initialThemes);

  const { createTheme, isCreating: isCreatingTheme } = useCreateTheme();
  const { addThemeToPost, isAdding: isAddingTheme, error: addThemeError } = useAddPostTheme();

  const handleVoteSuccess = useCallback(() => {
    setVoteRefreshKey((k) => k + 1);
  }, []);

  const parentMainTripleTermId = post.tripleLinks.find(t => t.role === "MAIN")?.termId ?? null;

  const handleCreateTheme = useCallback(async (name: string) => {
    const result = await createTheme(name, undefined, null);
    if (!result) return null;
    return { slug: result.slug, name: result.name };
  }, [createTheme]);

  const addThemeAndNotify = useCallback(async (params: Parameters<typeof addThemeToPost>[0]) => {
    const result = await addThemeToPost(params);
    if (!result) return false;
    setThemes((prev) => [...prev, { slug: result.slug, name: result.name }]);
    addToast("Theme added", "success");
    return true;
  }, [addThemeToPost, addToast]);

  const handleAddTheme = useCallback((theme: { slug: string; name: string }) =>
    addThemeAndNotify({
      postId: post.id,
      themeSlug: theme.slug,
      themeName: theme.name,
      mainTripleTermId: parentMainTripleTermId,
    }),
    [addThemeAndNotify, post.id, parentMainTripleTermId],
  );

  const handleLinkAtom = useCallback(async (atom: { id: string; label: string }) => {
    await addThemeAndNotify({
      postId: post.id,
      themeSlug: "",
      themeName: atom.label,
      mainTripleTermId: parentMainTripleTermId,
      atomTermId: atom.id,
      createThemeInDb: true,
    });
  }, [addThemeAndNotify, post.id, parentMainTripleTermId]);

  const handleCreateAndAddTheme = useCallback(async (name: string) => {
    const result = await createTheme(name, undefined, null);
    if (!result) return;
    await addThemeAndNotify({
      postId: post.id,
      themeSlug: result.slug,
      themeName: result.name,
      mainTripleTermId: parentMainTripleTermId,
    });
  }, [createTheme, addThemeAndNotify, post.id, parentMainTripleTermId]);

  const composerFlow = useComposerFlow({
    themes: replyThemes,
    parentPostId: post.id,
    parentMainTripleTermId,
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

  function handleReplyClick(stance: "SUPPORTS" | "REFUTES") {
    setInspectorOpen(false);
    composerFlow.openComposer(stance);
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
            stance={post.stance}
            themes={themes}
            onAddTheme={handleAddTheme}
            onLinkAtom={handleLinkAtom}
            onCreateTheme={handleCreateAndAddTheme}
            isAddingTheme={isAddingTheme || isCreatingTheme}
            addThemeError={addThemeError}
            onOpenInspector={handleOpenInspector}
            thumbSlot={parentMainTripleTermId ? (
              <ConnectedThumbVote tripleTermId={parentMainTripleTermId} size="md" onVoteSuccess={handleVoteSuccess} />
            ) : undefined}
          >
            {parentMainTripleTermId && (
              <VoteSection tripleTermId={parentMainTripleTermId} refreshKey={voteRefreshKey} />
            )}
          </FocusCard>

          <ComposerBlock
            composerFlow={composerFlow}
            themeSlot={
              <ThemeRow
                selected={replyThemes}
                onChange={setReplyThemes}
                min={1}
                onCreateTheme={handleCreateTheme}
              />
            }
            extraDisabled={replyThemes.length === 0}
            extraDisabledHint={replyThemes.length === 0 ? labels.selectAtLeastOneTheme : undefined}
          />

          <RepliesGrid
            supportReplies={supportReplies}
            refuteReplies={refuteReplies}
            onBadgeClick={handleReplyBadgeClick}
            onReply={handleReplyClick}
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
