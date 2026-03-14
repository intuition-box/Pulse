"use client";

import { useCallback, useState } from "react";

import type { Stance } from "../extraction";
import { useExtractionFlow } from "./useExtractionFlow";

export type UseComposerFlowParams = {
  themeSlug: string;
  parentPostId: string | null;
  parentMainTripleTermId?: string | null;
  themeAtomTermId?: string | null;
  onPublishSuccess: (postId: string) => void;
  autoOpen?: boolean;
  onClose?: () => void;
  /** Theme display name — forwarded to refine chat for context */
  themeTitle?: string;
  /** Parent claim body text — forwarded to refine chat for context */
  parentClaim?: string;
};

export function useComposerFlow({
  themeSlug,
  parentPostId,
  parentMainTripleTermId,
  themeAtomTermId,
  onPublishSuccess,
  autoOpen,
  onClose,
  themeTitle,
  parentClaim,
}: UseComposerFlowParams) {
  const [composerOpen, setComposerOpen] = useState(!!autoOpen);
  const [dialogOpen, setDialogOpen] = useState(false);
  const handlePublishSuccess = useCallback(
    (postId: string) => {
      setDialogOpen(false);
      setComposerOpen(false);
      onPublishSuccess(postId);
    },
    [onPublishSuccess],
  );

  const flow = useExtractionFlow({
    themeSlug,
    parentPostId,
    parentMainTripleTermId,
    themeAtomTermId,
    onPublishSuccess: handlePublishSuccess,
    themeTitle,
    parentClaim,
  });

  const { setStance, runExtraction } = flow;

  const openComposer = useCallback(
    (stance?: Stance) => {
      if (stance) setStance(stance);
      setComposerOpen(true);
    },
    [setStance],
  );

  const closeComposer = useCallback(() => {
    setComposerOpen(false);
    setDialogOpen(false);
    onClose?.();
  }, [onClose]);

  const handleExtract = useCallback(async () => {
    const result = await runExtraction();
    if (result.ok) {
      setDialogOpen(true);
    }
  }, [runExtraction]);

  return {
    composerOpen,
    openComposer,
    closeComposer,
    dialogOpen,
    setDialogOpen,
    flow,
    handleExtract,
  };
}

export type UseComposerFlowResult = ReturnType<typeof useComposerFlow>;
