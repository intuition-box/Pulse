"use client";

import { useState } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { Address, PublicClient, WalletClient } from "viem";
import { getMultiVaultAddressFromChainId } from "@0xintuition/sdk";

import { intuitionTestnet } from "@/lib/chain";
import { ensureIntuitionGraphql } from "@/lib/intuition";
import { labels } from "@/lib/vocabulary";
import {
  validateAtomRelevance,
  checkMeaningPreservation,
  isAllowed,
  getReferenceBodyForProposal,
} from "@/lib/validation/semanticRelevance";

import {
  assignNestedToDrafts,
  buildResolvedTripleMap,
  buildNestedEdgeContexts,
  collectNestedAtomLabels,
  buildPublishPlan,
  groupResolvedByDraft,
  computeEffectiveMainTargets,
  type ApprovedProposalWithRole,
  type DepositState,
  type DraftPost,
  type ExtractionJobSummary,
  type MainRef,
  type DerivedTripleDraft,
  type NestedProposalDraft,
  type ProposalDraft,
  type PublishSummary,
  type ResolvedNestedTriple,
  type ResolvedTriple,
  type TxPlanItem,
} from "../extraction";

import {
  hydrateMatchedTriples,
  resolveAtoms,
  resolveTriples,
  resolveDerivedTriples,
  resolveNestedTriples,
  resolveStanceTriples,
  resolveTagTriples,
  depositOnExistingTriples,
  PublishPipelineError,
  type StanceEntry,
  type TagEntry,
  type PublishContext,
} from "../publish";

type UseOnchainPublishParams = {
  // Wagmi
  isConnected: boolean;
  address: `0x${string}` | undefined;
  chainId: number;
  publicClient: PublicClient | undefined;
  walletClient: WalletClient | undefined;
  switchChainAsync: (params: { chainId: number }) => Promise<unknown>;
  // State
  extractionJob: ExtractionJobSummary | null;
  approvedProposals: ApprovedProposalWithRole[];
  draftPosts: DraftPost[];
  allDraftsHaveMain: boolean;
  contextDirty: boolean;
  minDeposit: bigint | null;
  // Setters
  setMessage: (msg: string | null) => void;
  setPublishedPosts: React.Dispatch<React.SetStateAction<PublishSummary[]>>;
  setTxPlan: React.Dispatch<React.SetStateAction<TxPlanItem[]>>;
  setDepositState: (state: DepositState) => void;
  // Dependencies
  ensureSession: () => Promise<boolean>;
  router: AppRouterInstance;
  onPublishSuccess?: (postId: string) => void;
  visibleNestedProposals: NestedProposalDraft[];
  proposals: ProposalDraft[];
  themeAtomTermId: string | null;
  mainRefByDraft: Map<string, MainRef | null>;
  derivedTriples: DerivedTripleDraft[];
  nestedRefLabels: Map<string, string>;
};

export type PublishStep = "preparing" | "terms" | "claims" | "linking" | "finalizing";

type UseOnchainPublishReturn = {
  isPublishing: boolean;
  publishStep: PublishStep | null;
  publishError: string | null;
  publishOnchain: () => Promise<void>;
  switchToCorrectChain: () => Promise<void>;
  resetPublishError: () => void;
};

export function useOnchainPublish({
  isConnected,
  address,
  chainId,
  publicClient,
  walletClient,
  switchChainAsync,
  extractionJob,
  approvedProposals,
  draftPosts,
  allDraftsHaveMain,
  contextDirty,
  minDeposit,
  setMessage,
  setPublishedPosts,
  setTxPlan,
  setDepositState,
  ensureSession,
  router,
  onPublishSuccess,
  visibleNestedProposals,
  proposals,
  themeAtomTermId,
  mainRefByDraft,
  derivedTriples,
  nestedRefLabels,
}: UseOnchainPublishParams): UseOnchainPublishReturn {
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishStep, setPublishStep] = useState<PublishStep | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  function resolveMainTripleTermId(
    mainRef: MainRef | null,
    resolvedByIndex: Array<ResolvedTriple | null>,
    resolvedNestedTriples: ResolvedNestedTriple[],
  ): string | null {
    if (!mainRef || mainRef.type === "error") return null;
    if (mainRef.type === "proposal") {
      return resolvedByIndex.find((r) => r?.proposalId === mainRef.id)?.tripleTermId ?? null;
    }
    return resolvedNestedTriples.find((r) => r.nestedProposalId === mainRef.nestedId)?.tripleTermId ?? null;
  }

  async function cancelPublish(submissionId: string, idempotencyKey: string, reason: string): Promise<boolean> {
    try {
      const res = await fetch("/api/publish/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, idempotencyKey, reason }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function publishOnchain() {
    setMessage(null);
    setPublishError(null);

    // Pre-flight checks
    if (!isConnected) {
      setMessage(labels.connectWalletToPublish);
      return;
    }

    if (!extractionJob) {
      setMessage("Run extraction before publishing.");
      return;
    }

    if (approvedProposals.length === 0) {
      setMessage(labels.preflightNoApproved);
      return;
    }

    if (!allDraftsHaveMain) {
      setMessage(labels.preflightNoMain);
      return;
    }

    if (contextDirty) {
      setMessage(labels.contentChangedWarning);
      return;
    }

    if (isPublishing) return; // Double-click guard

    setIsPublishing(true);
    setPublishStep("preparing");
    const idempotencyKey = crypto.randomUUID();
    let prepared = false;

    try {
      const publishPlan = buildPublishPlan({
        approvedProposals,
        draftPosts,
        nestedProposals: visibleNestedProposals,
        mainRefByDraft,
        parentPostId: extractionJob.parentPostId ?? null,
        parentMainTripleTermId: extractionJob.parentMainTripleTermId ?? null,
        themeAtomTermId: extractionJob.parentPostId ? null : themeAtomTermId,
      });

      const firstPlanError = publishPlan.errors[0];
      if (firstPlanError) {
        throw new PublishPipelineError(firstPlanError.code, firstPlanError.message);
      }
      const publishableProposals = publishPlan.publishableProposals;

      const { byDraft: nestedByDraft } = assignNestedToDrafts(
        visibleNestedProposals, draftPosts, proposals, derivedTriples,
      );

      for (const ap of publishableProposals) {
        const body = getReferenceBodyForProposal(ap.id, draftPosts);
        if (!body) {
          throw new PublishPipelineError(
            "relevance_check_failed",
            "Cannot publish: a claim has no associated post body.",
          );
        }
        const sCheck = validateAtomRelevance(ap.sText, body, "sText");
        if (!isAllowed(sCheck)) {
          throw new PublishPipelineError("relevance_check_failed", sCheck.reason!);
        }
        const oCheck = validateAtomRelevance(ap.oText, body, "oText");
        if (!isAllowed(oCheck)) {
          throw new PublishPipelineError("relevance_check_failed", oCheck.reason!);
        }
        const proposal = proposals.find((p) => p.id === ap.id);
        const draftId = draftPosts.find((d) => d.proposalIds.includes(ap.id))?.id;
        const draftNested = draftId ? nestedByDraft.get(draftId) ?? [] : [];
        const nestedCtx = proposal?.stableKey
          ? buildNestedEdgeContexts(proposal.stableKey, draftNested, nestedRefLabels)
          : [];
        const tripleCheck = checkMeaningPreservation(body, {
          subject: ap.sText, predicate: ap.pText, object: ap.oText,
        }, nestedCtx);
        if (!isAllowed(tripleCheck)) {
          throw new PublishPipelineError("relevance_check_failed", tripleCheck.reason!);
        }
      }
      const sessionOk = await ensureSession();
      if (!sessionOk) return;

      const prepareRes = await fetch("/api/publish/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: extractionJob.id,
          idempotencyKey,
        }),
      });

      if (!prepareRes.ok) {
        const prepareData = await prepareRes.json().catch(() => ({}));
        if (prepareData.alreadyPublished && prepareData.postId) {
          setPublishedPosts([{
            id: prepareData.postId,
            publishedAt: new Date().toISOString(),
          }]);
          if (onPublishSuccess) onPublishSuccess(prepareData.postId);
          return;
        }

        if (prepareData.existingKey) {
          const cancelled = await cancelPublish(
            extractionJob.id,
            prepareData.existingKey,
            "auto_recovery",
          );
          if (!cancelled) {
            setPublishError("Unable to resume previous attempt. Please try again.");
            return;
          }
          const retryRes = await fetch("/api/publish/prepare", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              submissionId: extractionJob.id,
              idempotencyKey,
            }),
          });
          if (!retryRes.ok) {
            const retryData = await retryRes.json().catch(() => ({}));
            setPublishError(retryData.error ?? "Failed to prepare publication.");
            return;
          }
        } else {
          setPublishError(prepareData.error ?? "Failed to prepare publication.");
          return;
        }
      }

      prepared = true;

      if (!walletClient || !publicClient || !address) {
        setPublishError("Wallet is initializing. Please wait a moment and try again.");
        await cancelPublish(extractionJob.id, idempotencyKey, "wallet_not_ready");
        return;
      }

      if (chainId !== intuitionTestnet.id) {
        try {
          await switchChainAsync({ chainId: intuitionTestnet.id });
        } catch {
          setPublishError("Please switch to the correct network.");
          await cancelPublish(extractionJob.id, idempotencyKey, "wrong_chain");
          return;
        }
      }

      ensureIntuitionGraphql();

      const multivaultAddress = getMultiVaultAddressFromChainId(intuitionTestnet.id) as Address;
      const ctx: PublishContext = {
        writeConfig: { walletClient, publicClient, multivaultAddress },
        accountAddress: address,
      };

      const resolvedByIndex: Array<ResolvedTriple | null> =
        new Array(publishableProposals.length).fill(null);

      const toResolve = await hydrateMatchedTriples(publishableProposals, resolvedByIndex);

      let atomTxHash: string | null = null;
      let tripleTxHash: string | null = null;
      let nestedTxHash: string | null = null;
      let stanceTxHash: string | null = null;
      let resolvedNestedTriples: ResolvedNestedTriple[] = [];

      const nestedAtomLabels = collectNestedAtomLabels(visibleNestedProposals);
      const derivedAtomLabels = derivedTriples.flatMap((dt) => [dt.subject, dt.predicate, dt.object]);
      const allExtraAtomLabels = [...nestedAtomLabels, ...derivedAtomLabels];

      let derivedTxHash: string | null = null;

      const { directMainProposalIds, mainNestedIds } = computeEffectiveMainTargets(draftPosts, mainRefByDraft);

      setPublishStep("terms");

      if (toResolve.length > 0 || visibleNestedProposals.length > 0 || derivedTriples.length > 0) {
        const atomResult = await resolveAtoms(toResolve, ctx, allExtraAtomLabels);
        atomTxHash = atomResult.atomTxHash;

        setPublishStep("claims");

        if (toResolve.length > 0) {
          const tripleResult = await resolveTriples(toResolve, atomResult.atomMap, resolvedByIndex, ctx, directMainProposalIds);
          tripleTxHash = tripleResult.tripleTxHash;
        }

        const resolvedTripleMap = buildResolvedTripleMap(resolvedByIndex, publishableProposals);

        if (derivedTriples.length > 0) {
          const derivedResult = await resolveDerivedTriples({
            derivedTriples,
            atomMap: atomResult.atomMap,
            ctx,
          });
          derivedTxHash = derivedResult.derivedTxHash;
          for (const [sk, tid] of derivedResult.resolvedDerived) {
            resolvedTripleMap.set(sk, tid);
          }
        }

        if (visibleNestedProposals.length > 0) {
          const nestedResult = await resolveNestedTriples({
            nestedProposals: visibleNestedProposals,
            resolvedTripleMap,
            atomMap: atomResult.atomMap,
            ctx,
            mainNestedIds,
          });
          resolvedNestedTriples = nestedResult.resolvedNested;
          nestedTxHash = nestedResult.nestedTxHash;
        }
      }

      setPublishStep("linking");

      const resolvedPlan: {
        stanceEntries: StanceEntry[];
        tagEntries: TagEntry[];
      } = {
        stanceEntries: [],
        tagEntries: [],
      };

      for (const entry of publishPlan.metadata.stanceEntries) {
        const mainRef = mainRefByDraft.get(entry.draftId) ?? null;
        const mainTripleTermId = resolveMainTripleTermId(mainRef, resolvedByIndex, resolvedNestedTriples);
        if (!mainTripleTermId) {
          throw new PublishPipelineError(
            "METADATA_UNRESOLVED",
            `Stance metadata unresolved for draft "${entry.draftId}" (main triple not resolved).`,
          );
        }
        resolvedPlan.stanceEntries.push({
          mainTripleTermId,
          mainProposalId: entry.mainProposalId ?? entry.draftId,
          stance: entry.stance,
          parentMainTripleTermId: entry.parentMainTripleTermId,
        });
      }

      if (resolvedPlan.stanceEntries.length > 0) {
        const stanceResult = await resolveStanceTriples({
          entries: resolvedPlan.stanceEntries,
          resolvedByIndex,
          ctx,
        });
        stanceTxHash = stanceResult.stanceTxHash;
      }

      let tagTxHash: string | null = null;
      const seenTagTriples = new Set<string>();
      for (const entry of publishPlan.metadata.tagEntries) {
        const mainRef = mainRefByDraft.get(entry.draftId) ?? null;
        const mainTripleTermId = resolveMainTripleTermId(mainRef, resolvedByIndex, resolvedNestedTriples);
        if (!mainTripleTermId) {
          throw new PublishPipelineError(
            "METADATA_UNRESOLVED",
            `Tag metadata unresolved for draft "${entry.draftId}" (main triple not resolved).`,
          );
        }
        const dedupeKey = `${mainTripleTermId}-${entry.themeAtomTermId}`;
        if (seenTagTriples.has(dedupeKey)) continue;
        seenTagTriples.add(dedupeKey);
        resolvedPlan.tagEntries.push({
          mainTripleTermId,
          mainProposalId: entry.mainProposalId ?? entry.draftId,
          themeAtomTermId: entry.themeAtomTermId,
        });
      }
      if (resolvedPlan.tagEntries.length > 0) {
        const tagResult = await resolveTagTriples({ entries: resolvedPlan.tagEntries, ctx });
        tagTxHash = tagResult.tagTxHash;
      }

      const orderedTriples = resolvedByIndex.filter(
        (t): t is ResolvedTriple => Boolean(t),
      );
      const stanceCount = resolvedPlan.stanceEntries.length;
      const expectedCount = publishableProposals.length + stanceCount;
      if (orderedTriples.length !== expectedCount) {
        throw new PublishPipelineError("resolution_incomplete", labels.errorResolution);
      }

      const allDraftPayloads = groupResolvedByDraft(
        resolvedByIndex,
        resolvedNestedTriples,
        draftPosts,
        proposals,
        visibleNestedProposals,
        mainRefByDraft,
        derivedTriples,
        nestedRefLabels,
      );
      const draftPayloads = allDraftPayloads.filter(
        (p) => p.triples.length > 0 || p.nestedTriples.length > 0,
      );

      const existingMainTripleTermIds = draftPayloads.flatMap((post) => [
        ...post.triples
          .filter((t) => t.role === "MAIN" && t.isExisting)
          .map((t) => t.tripleTermId),
        ...(post.nestedTriples ?? [])
          .filter((t) => t.role === "MAIN" && t.isExisting)
          .map((t) => t.tripleTermId),
      ]);

      if (existingMainTripleTermIds.length > 0) {
        setDepositState({ status: "depositing" });
        const depositResult = await depositOnExistingTriples({
          tripleTermIds: existingMainTripleTermIds,
          ctx,
          minDeposit,
        });
        setDepositState({
          status: "confirmed",
          txHash: depositResult.txHash,
          count: existingMainTripleTermIds.length,
        });
      } else {
        setDepositState({ status: "idle" });
      }

      const confirmPayload = {
        submissionId: extractionJob.id,
        idempotencyKey,
        posts: draftPayloads,
        atomTxHash,
        tripleTxHash,
        derivedTxHash,
        nestedTxHash,
        stanceTxHash,
        tagTxHash,
      };
      try {
        localStorage.setItem(
          `dm_publish_intent_${extractionJob.id}`,
          JSON.stringify({ ...confirmPayload, timestamp: Date.now() }),
        );
      } catch {
        // localStorage may be unavailable — proceed anyway
      }

      const sessionStillOk = await ensureSession();
      if (!sessionStillOk) {
        return;
      }

      setPublishStep("finalizing");

      const { fetchWithRetry } = await import("@/lib/net/fetchRetry");
      const response = await fetchWithRetry("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmPayload),
      }, { retries: 3, backoffMs: 1000 });

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        setPublishError("Server returned an invalid response. Please try again.");
        console.error("Invalid response from /api/publish:", {
          status: response.status,
          contentType,
          statusText: response.statusText,
        });
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        setPublishError(data.error ?? "Unable to publish.");
        return;
      }

      try {
        localStorage.removeItem(`dm_publish_intent_${extractionJob.id}`);
      } catch {
      }

      const posts: PublishSummary[] = data.posts ?? [];

      setTxPlan(data.txPlan ?? []);
      setPublishedPosts(posts);
      router.refresh();

      if (onPublishSuccess && posts[0]?.id) {
        onPublishSuccess(posts[0].id);
      }
    } catch (error) {
      if (error instanceof PublishPipelineError) {
        console.error("[publish] pipeline error", {
          code: error.code,
          message: error.message,
          stack: error.stack ?? null,
        });
        setPublishError(error.message);
        if (error.code === "deposit_failed") {
          setDepositState({ status: "failed", error: error.message });
        }
        if (prepared) {
          await cancelPublish(extractionJob!.id, idempotencyKey, error.code);
        }
      } else {
        console.error("[publish] unexpected error", error);
        const msg = error instanceof Error ? error.message : "Unable to publish.";
        setPublishError(msg);
        if (prepared) {
          await cancelPublish(extractionJob!.id, idempotencyKey, "unexpected_error");
        }
      }
    } finally {
      setIsPublishing(false);
      setPublishStep(null);
    }
  }

  async function switchToCorrectChain() {
    try {
      await switchChainAsync({ chainId: intuitionTestnet.id });
    } catch {
      setPublishError("Failed to switch network. Please switch manually.");
    }
  }

  return {
    isPublishing,
    publishStep,
    publishError,
    publishOnchain,
    switchToCorrectChain,
    resetPublishError: () => setPublishError(null),
  };
}
