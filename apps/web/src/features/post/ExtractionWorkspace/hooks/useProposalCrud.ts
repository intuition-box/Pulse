"use client";

import { useCallback, useRef, useEffect } from "react";
import { normalizeLabelForChain } from "@/lib/format/normalizeLabel";
import { conceptKey } from "@/lib/format/conceptKey";

import {
  findDraftIndex,
  isDraftId,
  makeDraftId,
  normalizeMain,
  type DraftPost,
  type ExtractionJobSummary,
  type PropagationResult,
  type ProposalDraft,
  type ProposalStatus,
} from "../extraction";

const normalizeText = normalizeLabelForChain;

const ATOM_FIELDS = [
  ["sText", "subjectAtomId", "subjectMatchedLabel"],
  ["pText", "predicateAtomId", "predicateMatchedLabel"],
  ["oText", "objectAtomId", "objectMatchedLabel"],
] as const;

export function computePropagation(
  proposals: ProposalDraft[],
  sourceSlotText: string,
  atomId: string,
  label: string,
  draftPosts: DraftPost[],
  metrics?: { holders: number | null; marketCap: number | null },
): { nextProposals: ProposalDraft[]; result: PropagationResult } {
  const key = conceptKey(sourceSlotText);
  let updatedClaims = 0;
  const touchedDraftIds = new Set<string>();

  const metaFieldMap = {
    sText: "subjectMeta",
    pText: "predicateMeta",
    oText: "objectMeta",
  } as const;

  const metaValue = {
    rationale: null,
    decisionPath: null,
    alternatives: [],
    selectedHolders: metrics?.holders ?? null,
    selectedShares: null,
    selectedMarketCap: metrics?.marketCap ?? null,
    selectedSharePrice: null,
  };

  const nextProposals = proposals.map((p) => {
    if (p.status === "rejected") return p;
    let updated = { ...p };
    let changed = false;

    for (const [textField, atomField, labelField] of ATOM_FIELDS) {
      const slotKey = conceptKey(p[textField]);
      if (slotKey !== key) continue;
      const currentAtomId = p[atomField] as string | null;
      if (currentAtomId === atomId) continue;
      updated = {
        ...updated,
        [atomField]: atomId,
        [labelField]: label,
        [metaFieldMap[textField]]: metaValue,
        matchedIntuitionTripleTermId: null,
      };
      changed = true;
    }

    if (changed) {
      updatedClaims++;
      const draft = draftPosts.find((d) => d.proposalIds.includes(p.id));
      if (draft) touchedDraftIds.add(draft.id);
    }
    return changed ? updated : p;
  });

  return { nextProposals, result: { updatedClaims, updatedPosts: touchedDraftIds.size } };
}

type UseProposalCrudParams = {
  proposals: ProposalDraft[];
  setProposals: React.Dispatch<React.SetStateAction<ProposalDraft[]>>;
  extractionJob: ExtractionJobSummary | null;
  setDraftPosts: React.Dispatch<React.SetStateAction<DraftPost[]>>;
  isConnected: boolean;
  setMessage: (msg: string | null) => void;
  setIsExtracting: (v: boolean) => void;
  ensureSession: () => Promise<boolean>;
};

type UseProposalCrudReturn = {
  updateProposalField: (id: string, field: "sText" | "pText" | "oText", value: string) => void;
  addDraftProposal: (targetDraftId?: string) => void;
  addTripleFromChat: (subject: string, predicate: string, object: string, targetDraftId?: string) => void;
  saveProposal: (id: string, overrides?: Partial<ProposalDraft>) => Promise<void>;
  lockProposalAtom: (id: string, field: "sText" | "pText" | "oText", atomId: string, label: string, metrics?: { holders: number | null; marketCap: number | null }) => void;
  unlockProposalAtom: (id: string, field: "sText" | "pText" | "oText") => void;
  resolveProposalAtom: (id: string, field: "sText" | "pText" | "oText", termId: string, canonicalLabel: string) => void;
  setMatchedTripleTermId: (id: string, tripleTermId: string | null, atoms?: { subjectAtomId: string; predicateAtomId: string; objectAtomId: string; sLabel: string; pLabel: string; oLabel: string }) => void;
  selectMain: (id: string) => void;
  rejectProposal: (id: string) => void;
  propagateAtomLock: (sourceSlotText: string, atomId: string, label: string, draftPosts: DraftPost[], metrics?: { holders: number | null; marketCap: number | null }) => PropagationResult;
  setNewTermLocal: (proposalId: string, field: "sText" | "pText" | "oText", label: string) => void;
};

export function useProposalCrud({
  proposals,
  setProposals,
  extractionJob,
  setDraftPosts,
  isConnected,
  setMessage,
  setIsExtracting,
  ensureSession,
}: UseProposalCrudParams): UseProposalCrudReturn {
  const proposalsRef = useRef(proposals);
  useEffect(() => { proposalsRef.current = proposals; }, [proposals]);

  function updateProposalField(proposalId: string, field: "sText" | "pText" | "oText", value: string) {
    setProposals((prev) => {
      const source = prev.find((p) => p.id === proposalId);
      if (!source) return prev;
      const oldValue = source[field];
      const shouldPropagate = oldValue && oldValue !== value;
      return prev.map((proposal) => {
        const isTarget = proposal.id === proposalId;
        const isSameAtom = shouldPropagate && proposal[field] === oldValue;
        if (!isTarget && !isSameAtom) return proposal;
        const next = { ...proposal, [field]: value };
        if (field === "sText") {
          next.subjectAtomId = null;
          next.subjectMatchedLabel = null;
        }
        if (field === "pText") {
          next.predicateAtomId = null;
          next.predicateMatchedLabel = null;
        }
        if (field === "oText") {
          next.objectAtomId = null;
          next.objectMatchedLabel = null;
        }
        next.matchedIntuitionTripleTermId = null;
        return next;
      });
    });
  }

  function addDraftProposal(targetDraftId?: string) {
    if (!isConnected) {
      setMessage("Connect your wallet to add proposals.");
      return;
    }

    if (!extractionJob) {
      setMessage("Run extraction before adding a manual triple.");
      return;
    }

    const empty = {
      sText: "",
      pText: "",
      oText: "",
      subjectAtomId: null,
      predicateAtomId: null,
      objectAtomId: null,
    };

    const draftId = makeDraftId(Date.now());

    setProposals((prev) => [
      ...prev,
      {
        id: draftId,
        stableKey: "",
        ...empty,
        role: "SUPPORTING" as const,
        subjectConfidence: null,
        predicateConfidence: null,
        objectConfidence: null,
        subjectMatchedLabel: null,
        predicateMatchedLabel: null,
        objectMatchedLabel: null,
        subjectMeta: null,
        predicateMeta: null,
        objectMeta: null,
        matchedIntuitionTripleTermId: null,
        suggestedStance: null,
        stanceAligned: null,
        stanceReason: null,
        isRelevant: null,
        claimText: "",
        sentenceText: "",
        groupKey: "0:0",
        outermostMainKey: null,
        status: "pending" as ProposalStatus,
        saved: { ...empty },
      },
    ]);

    setDraftPosts((prev) => {
      const targetFound = targetDraftId && prev.some((d) => d.id === targetDraftId);
      return prev.map((d, i) =>
        (targetFound ? d.id === targetDraftId : i === 0)
          ? { ...d, proposalIds: [...d.proposalIds, draftId] }
          : d,
      );
    });
  }

  function addTripleFromChat(subject: string, predicate: string, object: string, targetDraftId?: string) {
    if (!extractionJob) return;

    const sText = normalizeText(subject);
    const pText = normalizeText(predicate);
    const oText = normalizeText(object);
    if (!sText || !pText || !oText) return;

    const proposalId = `proposal-chat-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    setProposals((prev) => [
      ...prev,
      {
        id: proposalId,
        stableKey: "",
        sText,
        pText,
        oText,
        role: "SUPPORTING" as const,
        subjectAtomId: null,
        predicateAtomId: null,
        objectAtomId: null,
        subjectConfidence: null,
        predicateConfidence: null,
        objectConfidence: null,
        subjectMatchedLabel: null,
        predicateMatchedLabel: null,
        objectMatchedLabel: null,
        subjectMeta: null,
        predicateMeta: null,
        objectMeta: null,
        matchedIntuitionTripleTermId: null,
        suggestedStance: null,
        stanceAligned: null,
        stanceReason: null,
        isRelevant: null,
        claimText: "",
        sentenceText: `${sText} ${pText} ${oText}`,
        groupKey: "0:0",
        outermostMainKey: null,
        status: "approved" as ProposalStatus,
        saved: { sText, pText, oText, subjectAtomId: null, predicateAtomId: null, objectAtomId: null },
      },
    ]);

    setDraftPosts((prev) => {
      const targetFound = targetDraftId && prev.some((d) => d.id === targetDraftId);
      return prev.map((d, i) =>
        (targetFound ? d.id === targetDraftId : i === 0)
          ? { ...d, proposalIds: [...d.proposalIds, proposalId] }
          : d,
      );
    });
  }

  async function saveProposal(
    proposalId: string,
    overrides?: Partial<ProposalDraft>
  ): Promise<void> {
    setMessage(null);
    if (!isConnected) {
      setMessage("Connect your wallet to save proposals.");
      return;
    }
    const proposal = proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      return;
    }

    const next: ProposalDraft = {
      ...proposal,
      ...overrides,
      subjectAtomId:
        typeof overrides?.subjectAtomId === "undefined"
          ? proposal.subjectAtomId
          : overrides.subjectAtomId,
      predicateAtomId:
        typeof overrides?.predicateAtomId === "undefined"
          ? proposal.predicateAtomId
          : overrides.predicateAtomId,
      objectAtomId:
        typeof overrides?.objectAtomId === "undefined"
          ? proposal.objectAtomId
          : overrides.objectAtomId,
    };

    const isDirty =
      next.sText !== proposal.saved.sText ||
      next.pText !== proposal.saved.pText ||
      next.oText !== proposal.saved.oText ||
      next.subjectAtomId !== proposal.saved.subjectAtomId ||
      next.predicateAtomId !== proposal.saved.predicateAtomId ||
      next.objectAtomId !== proposal.saved.objectAtomId;

    const isDraft = isDraftId(proposalId);

    if (isDraft) {
      if (!extractionJob) {
        setMessage("Run extraction before adding a manual triple.");
        return;
      }

      const normalized = {
        sText: normalizeText(next.sText),
        pText: normalizeText(next.pText),
        oText: normalizeText(next.oText),
      };

      if (!normalized.sText || !normalized.pText || !normalized.oText) {
        setMessage("Fill subject, predicate, and object before saving.");
        return;
      }

      setIsExtracting(true);
      try {
        const sessionOk = await ensureSession();
        if (!sessionOk) {
          return;
        }

        const proposalId_generated = `proposal-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

        const sText = normalized.sText;
        const pText = normalized.pText;
        const oText = normalized.oText;

        setProposals((prev) =>
          prev.map((item) =>
                item.id === proposalId
              ? {
                  id: proposalId_generated,
                  stableKey: "",
                  sText,
                  pText,
                  oText,
                  role: item.role ?? ("SUPPORTING" as const),
                  status: "approved" as ProposalStatus,
                  subjectAtomId: next.subjectAtomId ?? null,
                  predicateAtomId: next.predicateAtomId ?? null,
                  objectAtomId: next.objectAtomId ?? null,
                  subjectConfidence: null,
                  predicateConfidence: null,
                  objectConfidence: null,
                  subjectMatchedLabel: null,
                  predicateMatchedLabel: null,
                  objectMatchedLabel: null,
                  subjectMeta: null,
                  predicateMeta: null,
                  objectMeta: null,
                  suggestedStance: null,
                  stanceAligned: null,
                  stanceReason: null,
                  isRelevant: null,
                  claimText: "",
                  sentenceText: "",
                  groupKey: item.groupKey ?? "0:0",
                  outermostMainKey: null,
                  saved: {
                    sText,
                    pText,
                    oText,
                    subjectAtomId: next.subjectAtomId ?? null,
                    predicateAtomId: next.predicateAtomId ?? null,
                    objectAtomId: next.objectAtomId ?? null,
                  },
                  matchedIntuitionTripleTermId: null,
                }
              : item
          )
        );

        setDraftPosts((prev) =>
          prev.map((d) => ({
            ...d,
            proposalIds: d.proposalIds.map((id) => (id === proposalId ? proposalId_generated : id)),
            mainProposalId: d.mainProposalId === proposalId ? proposalId_generated : d.mainProposalId,
          })),
        );
      } catch {
        setMessage("Unable to add manual triple.");
      } finally {
        setIsExtracting(false);
      }

      return;
    }

    if (!extractionJob || !isDirty) {
      return;
    }

    setIsExtracting(true);
    try {
      const sessionOk = await ensureSession();
      if (!sessionOk) {
        return;
      }

      setProposals((prev) =>
        prev.map((item) =>
          item.id === proposalId
            ? {
                ...item,
                saved: {
                  sText: item.sText,
                  pText: item.pText,
                  oText: item.oText,
                  subjectAtomId: item.subjectAtomId,
                  predicateAtomId: item.predicateAtomId,
                  objectAtomId: item.objectAtomId,
                },
              }
            : item
        )
      );
    } catch {
      setMessage("Unable to save edits.");
    } finally {
      setIsExtracting(false);
    }
  }

  const setMatchedTripleTermId = useCallback(
    (proposalId: string, tripleTermId: string | null, atoms?: { subjectAtomId: string; predicateAtomId: string; objectAtomId: string; sLabel: string; pLabel: string; oLabel: string }) => {
      setProposals((prev) =>
        prev.map((proposal) => {
          if (proposal.id !== proposalId) return proposal;
          const base = { ...proposal, matchedIntuitionTripleTermId: tripleTermId };
          if (!atoms) return base;
          return {
            ...base,
            subjectAtomId: atoms.subjectAtomId,
            predicateAtomId: atoms.predicateAtomId,
            objectAtomId: atoms.objectAtomId,
            subjectMatchedLabel: atoms.sLabel,
            predicateMatchedLabel: atoms.pLabel,
            objectMatchedLabel: atoms.oLabel,
          };
        })
      );
    },
    [setProposals],
  );

  function lockProposalAtom(
    proposalId: string,
    field: "sText" | "pText" | "oText",
    atomId: string,
    label: string,
    metrics?: { holders: number | null; marketCap: number | null },
  ) {
    const updates: Partial<ProposalDraft> = { [field]: label } as Partial<ProposalDraft>;
    const metaValue = {
      rationale: null,
      decisionPath: null,
      alternatives: [],
      selectedHolders: metrics?.holders ?? null,
      selectedShares: null,
      selectedMarketCap: metrics?.marketCap ?? null,
      selectedSharePrice: null,
    };
    if (field === "sText") {
      updates.subjectAtomId = atomId;
      updates.subjectMatchedLabel = label;
      updates.subjectMeta = metaValue;
    }
    if (field === "pText") {
      updates.predicateAtomId = atomId;
      updates.predicateMatchedLabel = label;
      updates.predicateMeta = metaValue;
    }
    if (field === "oText") {
      updates.objectAtomId = atomId;
      updates.objectMatchedLabel = label;
      updates.objectMeta = metaValue;
    }
    updates.matchedIntuitionTripleTermId = null;

    setProposals((prev) => {
      const source = prev.find((p) => p.id === proposalId);
      const oldValue = source?.[field];
      const shouldPropagate = oldValue && oldValue !== label;
      return prev.map((proposal) => {
        const isTarget = proposal.id === proposalId;
        const isSameAtom = shouldPropagate && proposal[field] === oldValue;
        if (!isTarget && !isSameAtom) return proposal;
        return { ...proposal, ...updates };
      });
    });

    if (!isDraftId(proposalId)) {
      void saveProposal(proposalId, updates);
    }
  }

  function unlockProposalAtom(proposalId: string, field: "sText" | "pText" | "oText") {
    const updates: Partial<ProposalDraft> = {};
    if (field === "sText") {
      updates.subjectAtomId = null;
      updates.subjectMatchedLabel = null;
    }
    if (field === "pText") {
      updates.predicateAtomId = null;
      updates.predicateMatchedLabel = null;
    }
    if (field === "oText") {
      updates.objectAtomId = null;
      updates.objectMatchedLabel = null;
    }
    updates.matchedIntuitionTripleTermId = null;

    setProposals((prev) =>
      prev.map((proposal) =>
        proposal.id === proposalId
          ? {
              ...proposal,
              ...updates,
            }
          : proposal
      )
    );

    if (!isDraftId(proposalId)) {
      void saveProposal(proposalId, updates);
    }
  }

  function selectMain(proposalId: string) {
    if (!extractionJob) return;
    if (isDraftId(proposalId)) return;
    if (!isConnected) {
      setMessage("Connect your wallet to update proposals.");
      return;
    }

    const proposal = proposals.find((p) => p.id === proposalId);
    if (!proposal || proposal.status === "rejected") return;

    setMessage(null);

    setDraftPosts((prev) => {
      const draftIdx = findDraftIndex(prev, proposalId);
      if (draftIdx === -1) return prev;
      if (prev[draftIdx].mainProposalId === proposalId) return prev;

      return prev.map((d, i) => {
        if (i !== draftIdx) return d;
        const updated = { ...d, mainProposalId: proposalId };
        if (d.body === d.bodyDefault) {
          const newBodyDefault = proposal.claimText || proposal.sentenceText || d.bodyDefault;
          updated.body = newBodyDefault;
          updated.bodyDefault = newBodyDefault;
        }
        return updated;
      });
    });
  }

  function rejectProposal(proposalId: string) {
    setMessage(null);

    if (!isConnected) {
      setMessage("Connect your wallet to update proposals.");
      return;
    }

    if (isDraftId(proposalId)) {
      setProposals((prev) => prev.filter((p) => p.id !== proposalId));
      setDraftPosts((prev) =>
        prev.map((d) => normalizeMain({
          ...d,
          proposalIds: d.proposalIds.filter((id) => id !== proposalId),
          mainProposalId: d.mainProposalId === proposalId ? null : d.mainProposalId,
        })),
      );
      return;
    }

    if (!extractionJob) return;

    setProposals((prev) =>
      prev.map((p) => (p.id === proposalId ? { ...p, status: "rejected" as ProposalStatus } : p))
    );

    setDraftPosts((prev) => {
      const draftIdx = findDraftIndex(prev, proposalId);
      if (draftIdx === -1) return prev;
      const draft = prev[draftIdx];
      if (draft.mainProposalId !== proposalId) return prev;
      const nextMain = draft.proposalIds.find(
        (id) => id !== proposalId && proposals.find((p) => p.id === id)?.status !== "rejected",
      ) ?? null;
      return prev.map((d, i) => (i === draftIdx ? { ...d, mainProposalId: nextMain } : d));
    });
  }

  function resolveProposalAtom(
    proposalId: string,
    field: "sText" | "pText" | "oText",
    termId: string,
    canonicalLabel: string,
  ) {
    setProposals((prev) =>
      prev.map((p) => {
        if (p.id !== proposalId) return p;
        const updates: Partial<ProposalDraft> = {};
        const label = canonicalLabel || p[field];
        if (field === "sText") {
          if (p.subjectAtomId && p.subjectAtomId !== termId) {
            updates.matchedIntuitionTripleTermId = null;
          }
          updates.subjectAtomId = termId;
          updates.subjectMatchedLabel = label;
        } else if (field === "pText") {
          if (p.predicateAtomId && p.predicateAtomId !== termId) {
            updates.matchedIntuitionTripleTermId = null;
          }
          updates.predicateAtomId = termId;
          updates.predicateMatchedLabel = label;
        } else {
          if (p.objectAtomId && p.objectAtomId !== termId) {
            updates.matchedIntuitionTripleTermId = null;
          }
          updates.objectAtomId = termId;
          updates.objectMatchedLabel = label;
        }
        return { ...p, ...updates };
      }),
    );
  }

  function propagateAtomLock(
    sourceSlotText: string,
    atomId: string,
    label: string,
    draftPosts: DraftPost[],
    metrics?: { holders: number | null; marketCap: number | null },
  ): PropagationResult {
    const snapshot = proposalsRef.current;
    const computed = computePropagation(snapshot, sourceSlotText, atomId, label, draftPosts, metrics);
    setProposals(computed.nextProposals);
    return computed.result;
  }

  function setNewTermLocal(proposalId: string, field: "sText" | "pText" | "oText", label: string) {
    const trimmed = label.trim();
    if (!trimmed || trimmed.startsWith("0x")) return;
    setProposals((prev) =>
      prev.map((p) => {
        if (p.id !== proposalId) return p;
        const updated = { ...p, [field]: trimmed, matchedIntuitionTripleTermId: null };
        if (field === "sText") {
          updated.subjectAtomId = null;
          updated.subjectMatchedLabel = null;
          updated.subjectMeta = null;
        } else if (field === "pText") {
          updated.predicateAtomId = null;
          updated.predicateMatchedLabel = null;
          updated.predicateMeta = null;
        } else {
          updated.objectAtomId = null;
          updated.objectMatchedLabel = null;
          updated.objectMeta = null;
        }
        return updated;
      }),
    );
  }

  return {
    updateProposalField,
    addDraftProposal,
    addTripleFromChat,
    saveProposal,
    lockProposalAtom,
    unlockProposalAtom,
    resolveProposalAtom,
    setMatchedTripleTermId,
    selectMain,
    rejectProposal,
    propagateAtomLock,
    setNewTermLocal,
  };
}
