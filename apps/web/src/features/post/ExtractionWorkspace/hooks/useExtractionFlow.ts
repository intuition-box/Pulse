"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";

import { atomKeyFromLabel } from "@db/agents";
import { intuitionTestnet } from "@/lib/chain";
import { normalizeLabelForChain } from "@/lib/format/normalizeLabel";
import { labels } from "@/lib/vocabulary";

import {
  buildDerivedTripleDraftsFromApi,
  buildNestedDraftsFromApi,
  makeDraftId,
  buildNestedRefLabelsFromState,
  buildProposalDraftsFromApi,
  computeMainRef,
  rebuildDraftFromMatchedTree,
  type ApiDerivedTriple,
  type ApiProposal,
  type ApprovedProposalWithRole,
  type DepositState,
  type DerivedTripleDraft,
  type ExtractionContext,
  type ExtractionJobSummary,
  type MainRef,
  type MatchedTree,
  type NestedProposalDraft,
  type ProposalActions,
  type DraftActions,
  type DraftPost,
  type ProposalDraft,
  type PublishSummary,
  type Stance,
  type TripleRole,
  type TxPlanItem,
  type UseExtractionFlowParams,
} from "../extraction";
import type { RewriteResult } from "../extraction/treeRewrite";
import { buildExtractedTree } from "../extraction/treeBuild";
import { treeLeavesMatch, treeDepth, collectLeaves, normalizeLeaf } from "./matchTree";
import { useSessionAuth } from "./useSessionAuth";
import { useDraftPosts } from "./useDraftPosts";
import { useOnchainPublish } from "./useOnchainPublish";
import { useProposalCrud } from "./useProposalCrud";
import { useTripleResolution } from "./useTripleResolution";

const normalizeText = normalizeLabelForChain;

async function searchOnChainTrees(
  query: string,
): Promise<{ trees: Array<{ termId: string; tree: MatchedTree; positionCount: number }> }> {
  try {
    const res = await fetch("/api/intuition/search-nested-tree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 10 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { trees: [] };
    return await res.json();
  } catch {
    return { trees: [] };
  }
}

export function useExtractionFlow({ themes, parentPostId, parentMainTripleTermId, onPublishSuccess, parentClaim }: UseExtractionFlowParams) {
  const themeSlug = themes[0]?.slug ?? "";
  const themeSlugs = themes.map((t) => t.slug);
  const router = useRouter();
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  const [stance, setStance] = useState<Stance | "">("");
  const [inputText, setInputText] = useState("");
  const [extractionJob, setExtractionJob] = useState<ExtractionJobSummary | null>(null);
  const [proposals, setProposals] = useState<ProposalDraft[]>([]);
  const [nestedProposals, setNestedProposals] = useState<NestedProposalDraft[]>([]);
  const [derivedTriples, setDerivedTriples] = useState<DerivedTripleDraft[]>([]);
  const [, setTxPlan] = useState<TxPlanItem[]>([]);
  const [publishedPosts, setPublishedPosts] = useState<PublishSummary[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionContext, setExtractionContext] = useState<ExtractionContext | null>(null);
  const [depositState, setDepositState] = useState<DepositState>({ status: "idle" });

  const { ensureSession } = useSessionAuth({ setMessage });
  const clearRewriteGuardRef = useRef<(() => void) | null>(null);

  const {
    draftPosts, setDraftPosts, initializeDrafts, allDraftsHaveMain,
    splitDrafts,
    updateDraftStance, updateDraftBody, resetDraftBody, removeDraft,
  } = useDraftPosts(proposals);

  const stanceRequired = Boolean(parentPostId);
  const normalizedInput = normalizeText(inputText);
  const normalizedStance = stanceRequired ? (stance as Stance) : null;

  const mainRefByDraft = useMemo<Map<string, MainRef | null>>(
    () => new Map(draftPosts.map((d) => [d.id, computeMainRef(d.mainProposalId, proposals, nestedProposals)])),
    [draftPosts, proposals, nestedProposals],
  );

  const baseNestedRefLabels = useMemo(
    () => buildNestedRefLabelsFromState(proposals, nestedProposals, derivedTriples),
    [proposals, nestedProposals, derivedTriples],
  );

  const allDraftsHaveValidMain = useMemo(() => {
    if (!allDraftsHaveMain) return false;
    return draftPosts.every((draft) => {
      const active = proposals.filter(
        (p) => draft.proposalIds.includes(p.id) && p.status !== "rejected",
      );
      if (active.length === 0) return true;
      const ref = mainRefByDraft.get(draft.id);
      return ref !== null && ref !== undefined && ref.type !== "error";
    });
  }, [allDraftsHaveMain, draftPosts, proposals, mainRefByDraft]);

  const approvedEntries = useMemo(
    () =>
      draftPosts.flatMap((draft) => {
        const mainRef = mainRefByDraft.get(draft.id);
        return draft.proposalIds
          .filter((id) => proposals.find((p) => p.id === id)?.status === "approved")
          .map((id) => ({
            proposalId: id,
            role: (mainRef?.type === "nested" || mainRef?.type === "error"
              ? "SUPPORTING"
              : id === draft.mainProposalId ? "MAIN" : "SUPPORTING") as TripleRole,
          }));
      }),
    [draftPosts, proposals, mainRefByDraft],
  );

  const contextDirty = Boolean(
    extractionContext &&
      (extractionContext.inputText !== normalizedInput ||
        extractionContext.parentPostId !== parentPostId ||
        extractionContext.stance !== normalizedStance)
  );

  const approvedProposals = useMemo<ApprovedProposalWithRole[]>(() => {
    return approvedEntries
      .map((entry) => {
        const proposal = proposals.find((p) => p.id === entry.proposalId);
        return proposal ? { ...proposal, role: entry.role } : null;
      })
      .filter((p): p is ApprovedProposalWithRole => p !== null);
  }, [approvedEntries, proposals]);

  const proposalCount = proposals.filter((p) => p.status !== "rejected").length;

  const visibleNestedProposals = useMemo(() => {
    const activeStableKeys = new Set([
      ...proposals.filter((p) => p.status !== "rejected").map((p) => p.stableKey).filter(Boolean),
      ...nestedProposals.filter((e) => e.status !== "rejected").map((e) => e.stableKey).filter(Boolean),
      ...derivedTriples.map((d) => d.stableKey).filter(Boolean),
    ]);
    return nestedProposals.filter((edge) => {
      if (edge.status === "rejected") return false;
      const subjectOk = edge.subject.type !== "triple" || activeStableKeys.has(edge.subject.tripleKey);
      const objectOk = edge.object.type !== "triple" || activeStableKeys.has(edge.object.tripleKey);
      return subjectOk && objectOk;
    });
  }, [proposals, nestedProposals, derivedTriples]);

  const updateNestedPredicate = useCallback((nestedId: string, label: string) => {
    setNestedProposals((prev) =>
      prev.map((edge) => edge.id === nestedId ? { ...edge, predicate: label } : edge),
    );
  }, []);

  const updateNestedAtom = useCallback((nestedId: string, slot: "subject" | "object", label: string) => {
    setNestedProposals((prev) =>
      prev.map((edge) => {
        if (edge.id !== nestedId) return edge;
        const ref = edge[slot];
        if (ref.type !== "atom") return edge;
        return { ...edge, [slot]: { ...ref, label } };
      }),
    );
  }, []);

  const updateDerivedTriple = useCallback(
    (stableKey: string, field: "subject" | "predicate" | "object", value: string) => {
      setDerivedTriples((prev) =>
        prev.map((dt) => (dt.stableKey === stableKey ? { ...dt, [field]: value } : dt)),
      );
    },
    [],
  );

  async function runExtraction(): Promise<{ ok: boolean; proposalCount: number }> {
    setMessage(null);
    const fail = { ok: false, proposalCount: 0 };

    if (!isConnected) {
      setMessage("Connect your wallet to extract proposals.");
      return fail;
    }

    if (!normalizedInput) {
      setMessage("Write your post text before validating.");
      return fail;
    }

    if (stanceRequired && !normalizedStance) {
      setMessage("Select a stance before validating.");
      return fail;
    }

    setIsExtracting(true);
    try {
      const sessionOk = await ensureSession();
      if (!sessionOk) {
        return fail;
      }

      const [data, searchData] = await Promise.all([
        (async () => {
          const response = await fetch("/api/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              themeSlug: themeSlug,
              inputText: normalizedInput,
              parentPostId: parentPostId,
              stance: normalizedStance,
            }),
          });

          const reader = response.body?.getReader();
          if (!reader) return null;
          const decoder = new TextDecoder();
          let buffer = "";
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let parsed: any = null;
          for (;;) {
            const { done, value } = await reader.read();
            if (value) buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                parsed = JSON.parse(line.slice(6));
              }
            }
            if (done) break;
          }
          return parsed;
        })(),
        searchOnChainTrees(normalizedInput),
      ]);

      if (!data) {
        setMessage("Unable to extract proposals.");
        return fail;
      }

      const status = (data._status as number) ?? 200;
      if (status !== 200) {
        if (data.rejection) {
          const code = data.error as string;
          const messageMap: Record<string, string> = {
            OFF_TOPIC: labels.rejectionOffTopic,
            NOT_DEBATABLE: labels.rejectionNotDebatable,
            GIBBERISH: labels.rejectionGibberish,
            NO_MAIN_CLAIMS: labels.rejectionNoMainClaims,
            NO_NEW_INFORMATION: labels.rejectionNoNewInformation,
            LLM_UNAVAILABLE: labels.rejectionLlmUnavailable,
            EXTRACTION_FAILED: labels.rejectionExtractionFailed,
          };
          setMessage(messageMap[code] ?? "Unable to extract proposals.");
        } else {
          setMessage((data.error as string) ?? "Unable to extract proposals.");
        }
        return fail;
      }

      const allExtracted = [
        ...(data.proposals ?? []),
        ...(data.nestedProposals ?? []),
      ] as ApiProposal[];
      const newProposals = buildProposalDraftsFromApi(allExtracted, true);
      const newNested = buildNestedDraftsFromApi(allExtracted);
      const newDerived = buildDerivedTripleDraftsFromApi((data.derivedTriples ?? []) as ApiDerivedTriple[]);

      const groupMap = new Map<string, string[]>();
      const groupMain = new Map<string, string>();
      for (const p of newProposals) {
        const gk = p.groupKey ?? "0:0";
        const ids = groupMap.get(gk) || [];
        ids.push(p.id);
        groupMap.set(gk, ids);
        if (p.role === "MAIN") groupMain.set(gk, p.id);
      }

      let reconciledProposals = newProposals;
      let reconciledNested = newNested;
      let reconciledDerived = newDerived;
      let reconciledMainId: string | null = null;

      const onChainTrees = searchData.trees ?? [];

      if (onChainTrees.length > 0 && groupMap.size <= 1) {
        const mainId = groupMain.values().next().value ?? newProposals[0]?.id ?? null;
        const mainP = mainId ? newProposals.find((p) => p.id === mainId) : null;

        if (mainP) {
          const tempDraft: DraftPost = {
            id: makeDraftId(0),
            stance: normalizedStance,
            mainProposalId: mainId,
            proposalIds: newProposals.map((p) => p.id),
            body: mainP.claimText || mainP.sentenceText || normalizedInput,
            bodyDefault: mainP.claimText || mainP.sentenceText || normalizedInput,
          };

          const extractedTree = buildExtractedTree(tempDraft, newProposals, newNested, newDerived);

          if (extractedTree) {
            // Case 1: Full tree match (same depth) — rewrite atom boundaries
            let rewriteResult: RewriteResult | null = null;
            for (const candidate of onChainTrees) {
              if (treeLeavesMatch(candidate.tree, extractedTree)
                  && treeDepth(candidate.tree) >= treeDepth(extractedTree)) {
                rewriteResult = rebuildDraftFromMatchedTree(candidate.tree, mainP, candidate.termId);
                break;
              }
            }

            if (rewriteResult) {
              const rewrittenIds = new Set(rewriteResult.proposals.map((p) => p.id));
              const keptSupporting = newProposals.filter(
                (p) => p.role === "SUPPORTING" && !rewrittenIds.has(p.id) && !p.outermostMainKey,
              );
              reconciledProposals = [...rewriteResult.proposals, ...keptSupporting];
              reconciledNested = rewriteResult.nestedProposals;
              reconciledDerived = [];
              reconciledMainId = rewriteResult.mainProposalId;
            }

          }
        }

        // Case 2: Partial match — tag existing sub-triples without rewriting structure
        // Runs for both flat and nested mains. Skipped if Case 1 already rewrote.
        if (!reconciledMainId) {
          for (const candidate of onChainTrees) {
            const candidateConcat = collectLeaves(candidate.tree).map(normalizeLeaf).join(" ");

            const matchedProposal = reconciledProposals.find((p) => {
              const pConcat = [p.sText, p.pText, p.oText].map(normalizeLeaf).join(" ");
              return pConcat === candidateConcat;
            });

            if (matchedProposal) {
              matchedProposal.matchedIntuitionTripleTermId = candidate.termId;
              matchedProposal.sText = candidate.tree.subject;
              matchedProposal.pText = candidate.tree.predicate;
              matchedProposal.oText = candidate.tree.object;
              matchedProposal.saved = {
                ...matchedProposal.saved,
                sText: candidate.tree.subject,
                pText: candidate.tree.predicate,
                oText: candidate.tree.object,
              };
            }
          }
        }
      }

      setExtractionJob({
        id: data.submission.id,
        status: data.submission.status,
        parentPostId,
        stance: normalizedStance,
        parentMainTripleTermId,
      });
      setProposals(reconciledProposals);
      setNestedProposals(reconciledNested);
      setDerivedTriples(reconciledDerived);
      clearRewriteGuardRef.current?.();

      if (groupMap.size <= 1) {
        const effectiveMainId = reconciledMainId
          ?? groupMain.values().next().value
          ?? reconciledProposals[0]?.id
          ?? null;
        const effectiveMainP = reconciledProposals.find((p) => p.id === effectiveMainId);
        const singleBody = (effectiveMainP?.claimText || effectiveMainP?.sentenceText || normalizedInput).replace(/\.\s*$/, "");
        initializeDrafts(normalizedStance, reconciledProposals.map((p) => p.id), effectiveMainId, singleBody);
      } else {
        const drafts: DraftPost[] = [...groupMap.entries()].map(([gk, ids], idx) => {
          const mainId = groupMain.get(gk) ?? ids[0];
          const mainP = newProposals.find((p) => p.id === mainId);
          const bodyDefault = (mainP?.claimText || mainP?.sentenceText || `${mainP?.sText} ${mainP?.pText} ${mainP?.oText}`).replace(/\.\s*$/, "");
          return {
            id: makeDraftId(idx),
            stance: normalizedStance,
            mainProposalId: mainId,
            proposalIds: ids,
            body: bodyDefault,
            bodyDefault,
          };
        });
        setDraftPosts(drafts);
      }
      setTxPlan([]);
      setPublishedPosts([]);
      setExtractionContext({
        inputText: normalizedInput,
        parentPostId,
        stance: normalizedStance,
      });
      return { ok: true, proposalCount: reconciledProposals.length };
    } catch {
      setMessage("Unable to extract proposals.");
      return fail;
    } finally {
      setIsExtracting(false);
    }
  }

  const crud = useProposalCrud({
    proposals,
    setProposals,
    extractionJob,
    setDraftPosts,
    isConnected,
    setMessage,
    setIsExtracting,
    ensureSession,
  });

  // Collect extra atom labels from nested edges + derived triples for resolution
  const extraAtomLabels = useMemo(() => {
    const labels: string[] = [];
    for (const ne of visibleNestedProposals) {
      if (ne.predicate) labels.push(ne.predicate);
      for (const ref of [ne.subject, ne.object]) {
        if (ref.type === "atom" && ref.label) labels.push(ref.label);
      }
    }
    for (const dt of derivedTriples) {
      if (dt.subject) labels.push(dt.subject);
      if (dt.predicate) labels.push(dt.predicate);
      if (dt.object) labels.push(dt.object);
    }
    for (const theme of themes) {
      labels.push(theme.slug);
    }
    return labels;
  }, [visibleNestedProposals, derivedTriples, themes]);

  const rewriteDraftForTreeMatch = useCallback((draftId: string, tree: MatchedTree, termId: string) => {
    const draft = draftPosts.find((d) => d.id === draftId);
    if (!draft) return;
    const mainP = proposals.find((p) => p.id === draft.mainProposalId);
    if (!mainP) return;

    const result = rebuildDraftFromMatchedTree(tree, mainP, termId);

    const draftProposalIds = new Set(draft.proposalIds);
    const oldProposals = proposals.filter((p) => draftProposalIds.has(p.id));
    const oldChainKeys = new Set(
      oldProposals.map((p) => p.stableKey).filter(Boolean),
    );
    if (mainP.outermostMainKey) oldChainKeys.add(mainP.outermostMainKey);
    const oldGroupKeys = new Set(
      oldProposals.map((p) => p.groupKey).filter(Boolean),
    );

    setProposals((prev) => [
      ...prev.filter((p) => !draftProposalIds.has(p.id)),
      ...result.proposals,
    ]);

    setNestedProposals((prev) => {
      let changed = true;
      while (changed) {
        changed = false;
        for (const e of prev) {
          if (!oldChainKeys.has(e.stableKey)) {
            const sRelated = e.subject.type === "triple" && oldChainKeys.has(e.subject.tripleKey);
            const oRelated = e.object.type === "triple" && oldChainKeys.has(e.object.tripleKey);
            if (sRelated || oRelated) {
              oldChainKeys.add(e.stableKey);
              changed = true;
            }
          }
          if (oldChainKeys.has(e.stableKey)) {
            if (e.subject.type === "triple" && !oldChainKeys.has(e.subject.tripleKey)) {
              oldChainKeys.add(e.subject.tripleKey);
              changed = true;
            }
            if (e.object.type === "triple" && !oldChainKeys.has(e.object.tripleKey)) {
              oldChainKeys.add(e.object.tripleKey);
              changed = true;
            }
          }
        }
      }
      return [
        ...prev.filter((e) => !oldChainKeys.has(e.stableKey)),
        ...result.nestedProposals,
      ];
    });

    setDerivedTriples((prev) =>
      prev.filter((dt) => !oldGroupKeys.has(dt.ownerGroupKey)),
    );

    setDraftPosts((prev) =>
      prev.map((d) =>
        d.id === draftId
          ? { ...d, proposalIds: result.proposals.map((p) => p.id), mainProposalId: result.mainProposalId }
          : d,
      ),
    );
  }, [draftPosts, proposals, setProposals, setNestedProposals, setDerivedTriples, setDraftPosts]);

  const resolution = useTripleResolution({
    approvedProposals,
    address,
    extraAtomLabels,
    nestedProposals: visibleNestedProposals,
    derivedTriples,
    draftPosts,
    themes,
    onTripleMatched: crud.setMatchedTripleTermId,
    onAtomResolved: crud.resolveProposalAtom,
    onTreeMatchRewrite: rewriteDraftForTreeMatch,
  });
  clearRewriteGuardRef.current = resolution.clearRewriteGuard;

  const nestedRefLabels = useMemo(() => {
    if (resolution.resolvedAtomLabels.size === 0) return baseNestedRefLabels;
    const merged = new Map(baseNestedRefLabels);
    for (const [inputLabel, canonicalLabel] of resolution.resolvedAtomLabels) {
      const key = `atom:${atomKeyFromLabel(inputLabel)}`;
      merged.set(key, canonicalLabel);
    }
    return merged;
  }, [baseNestedRefLabels, resolution.resolvedAtomLabels]);

  const fullTreeMatchDraftIds = useMemo(() => {
    const set = new Set<string>();
    for (const [draftId] of resolution.fullTreeMatchByDraft) {
      set.add(draftId);
    }
    return set;
  }, [resolution.fullTreeMatchByDraft]);

  const publish = useOnchainPublish({
    isConnected,
    address,
    chainId,
    publicClient,
    walletClient,
    switchChainAsync,
    extractionJob,
    approvedProposals,
    draftPosts,
    allDraftsHaveMain: allDraftsHaveValidMain,
    contextDirty,
    minDeposit: resolution.minDeposit,
    setMessage,
    setPublishedPosts,
    setTxPlan,
    setDepositState,
    ensureSession,
    router,
    onPublishSuccess,
    visibleNestedProposals,
    proposals,
    themes,
    themeSlugs,
    mainRefByDraft,
    derivedTriples,
    nestedRefLabels,
    fullTreeMatchDraftIds,
    resolutionMap: resolution.resolutionMap,
  });

  const busy = isExtracting || publish.isPublishing;

  const proposalActions: ProposalActions = {
    onChange: crud.updateProposalField,
    onSave: crud.saveProposal,
    onSelectMain: crud.selectMain,
    onReject: crud.rejectProposal,
    onLock: crud.lockProposalAtom,
    onUnlock: crud.unlockProposalAtom,
    onAddDraft: crud.addDraftProposal,
    onAddTriple: crud.addTripleFromChat,
    onPropagateAtom: (text, id, label, metrics) => crud.propagateAtomLock(text, id, label, draftPosts, metrics),
    onSetNewTermLocal: crud.setNewTermLocal,
  };

  const draftActions: DraftActions = {
    onSplit: () => { splitDrafts(normalizedStance); clearRewriteGuardRef.current?.(); },
    onStanceChange: updateDraftStance,
    onBodyChange: updateDraftBody,
    onBodyReset: resetDraftBody,
    onRemove: removeDraft,
  };

  function handleInputChange(value: string) {
    setInputText(value);
    if (message) setMessage(null);
  }

  return {
    inputText,
    setInputText: handleInputChange,
    extractedInputText: extractionContext?.inputText ?? "",
    stance,
    setStance,
    stanceRequired,
    walletConnected: isConnected,
    correctChain: chainId === intuitionTestnet.id,
    switchToCorrectChain: publish.switchToCorrectChain,
    extractionJob,
    proposals,
    derivedTriples,
    visibleNestedProposals,
    displayNestedProposals: visibleNestedProposals,
    nestedRefLabels,
    proposalCount,
    draftPosts,
    approvedProposals,
    mainRefByDraft,
    message,
    contextDirty,
    busy,
    isExtracting,
    minDeposit: resolution.minDeposit,
    atomCost: resolution.atomCost,
    tripleCost: resolution.tripleCost,
    depositState,
    approvedTripleStatuses: resolution.approvedTripleStatuses,
    approvedTripleStatus: resolution.approvedTripleStatus,
    approvedTripleStatusError: resolution.approvedTripleStatusError,
    semanticSkipped: resolution.semanticSkipped,
    resolvedAtomMap: resolution.resolvedAtomMap,
    nestedTripleStatuses: resolution.nestedTripleStatuses,
    metadataTripleStatuses: resolution.metadataTripleStatuses,
    derivedCanonicalLabels: resolution.derivedCanonicalLabels,
    fullTreeMatchByDraft: resolution.fullTreeMatchByDraft,
    retryTripleCheck: resolution.retryCheck,
    publishedPosts,
    isPublishing: publish.isPublishing,
    publishStep: publish.publishStep,
    publishError: publish.publishError,
    resetPublishError: publish.resetPublishError,
    runExtraction,
    proposalActions,
    draftActions,
    publishOnchain: publish.publishOnchain,
    setBlockedDraftIds: publish.setBlockedDraftIds,
    themes,
    parentClaim,
    parentMainTripleTermId: parentMainTripleTermId ?? null,
    updateNestedPredicate,
    updateNestedAtom,
    updateDerivedTriple,
  };
}

export type UseExtractionFlowResult = ReturnType<typeof useExtractionFlow>;
