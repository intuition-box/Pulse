"use client";

import { useState } from "react";

import {
  createInitialDraft,
  normalizeMain,
  splitIntoDrafts,
  makeDraftId,
  type DraftPost,
  type ProposalDraft,
  type Stance,
} from "../extraction";

type UseDraftPostsReturn = {
  draftPosts: DraftPost[];
  setDraftPosts: React.Dispatch<React.SetStateAction<DraftPost[]>>;
  initializeDrafts: (stance: Stance | null, proposalIds: string[], mainProposalId?: string | null, bodyDefault?: string) => void;
  resetDrafts: () => void;
  allDraftsHaveMain: boolean;
  splitDrafts: (userStance: Stance | null) => void;
  updateDraftStance: (draftId: string, stance: Stance) => void;
  updateDraftBody: (draftId: string, body: string) => void;
  resetDraftBody: (draftId: string) => void;
  removeDraft: (draftId: string) => void;
};

export function useDraftPosts(proposals: ProposalDraft[]): UseDraftPostsReturn {
  const [draftPosts, setDraftPosts] = useState<DraftPost[]>([]);

  function initializeDrafts(stance: Stance | null, proposalIds: string[], mainProposalId?: string | null, bodyDefault?: string) {
    setDraftPosts([normalizeMain(createInitialDraft(makeDraftId(0), stance, proposalIds, mainProposalId, bodyDefault))]);
  }

  function resetDrafts() {
    setDraftPosts([]);
  }

  const allDraftsHaveMain = draftPosts.every((draft) => {
    const active = proposals.filter(
      (p) => draft.proposalIds.includes(p.id) && p.status !== "rejected",
    );
    if (active.length === 0) return true;
    return (
      draft.mainProposalId !== null &&
      proposals.find((p) => p.id === draft.mainProposalId)?.status === "approved"
    );
  });

  if (process.env.NODE_ENV !== "production") {
    const allIds = draftPosts.flatMap((d) => d.proposalIds);
    const unique = new Set(allIds);
    if (unique.size !== allIds.length) {
      console.error("[useDraftPosts] Invariant I2 violated: duplicate proposalId across drafts");
    }
  }

  function splitDraftsHandler(userStance: Stance | null) {
    setDraftPosts((prev) => splitIntoDrafts(prev, proposals, userStance));
  }

  function updateDraftStance(draftId: string, stance: Stance) {
    setDraftPosts((prev) => prev.map((d) => (d.id === draftId ? { ...d, stance } : d)));
  }

  function updateDraftBody(draftId: string, body: string) {
    setDraftPosts((prev) => prev.map((d) => (d.id === draftId ? { ...d, body } : d)));
  }

  function resetDraftBody(draftId: string) {
    setDraftPosts((prev) => prev.map((d) => (d.id === draftId ? { ...d, body: d.bodyDefault } : d)));
  }

  function removeDraft(draftId: string) {
    setDraftPosts((prev) => {
      const next = prev.filter((d) => d.id !== draftId);
      // Never remove the last draft
      if (next.length === 0) return prev;
      return next;
    });
  }

  const [prevProposals, setPrevProposals] = useState(proposals);
  if (prevProposals !== proposals) {
    setPrevProposals(proposals);
    if (draftPosts.length > 1) {
      const next = draftPosts.map((draft) => {
        const main = proposals.find((p) => p.id === draft.mainProposalId);
        if (!main) return draft;
        const newBodyDefault = main.claimText || main.sentenceText || `${main.sText} ${main.pText} ${main.oText}`;
        if (newBodyDefault === draft.bodyDefault) return draft;
        const bodyWasDefault = draft.body === draft.bodyDefault;
        return {
          ...draft,
          bodyDefault: newBodyDefault,
          body: bodyWasDefault ? newBodyDefault : draft.body,
        };
      });
      if (next.some((d, i) => d !== draftPosts[i])) setDraftPosts(next);
    }
  }

  return {
    draftPosts, setDraftPosts, initializeDrafts, resetDrafts, allDraftsHaveMain,
    splitDrafts: splitDraftsHandler,
    updateDraftStance, updateDraftBody, resetDraftBody, removeDraft,
  };
}
