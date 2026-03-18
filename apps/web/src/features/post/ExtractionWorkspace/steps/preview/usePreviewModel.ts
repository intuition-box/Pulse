import { useMemo } from "react";
import { intuitionTestnet } from "@/lib/chain";
import { normalizeLabelForChain } from "@/lib/format/normalizeLabel";
import { labels } from "@/lib/vocabulary";
import {
  validateAtomRelevance,
  checkMeaningPreservation,
  checkChainLabelMeaning,
  isAllowed,
  getReferenceBodyForProposal,
} from "@/lib/validation/semanticRelevance";

import {
  assignNestedToDrafts,
  buildPublishPlan,
  buildNestedEdgeContexts,
  computeEffectiveMainTargets,
  safeDisplayLabel,
  type ApprovedProposalWithRole,
  type ApprovedTripleStatus,
  type ApprovedTripleStatusState,
  type DerivedTripleDraft,
  type DraftPost,
  type PublishPlan,
  type MainRef,
  type NestedProposalDraft,
  type ProposalDraft,
} from "../../extraction";

import { formatCost, isCtaDisabled, type AtomInfo, type Check, type ViewState } from "./previewTypes";

export type PreviewModelInputs = {
  approvedProposals: ApprovedProposalWithRole[];
  approvedTripleStatuses: ApprovedTripleStatus[];
  approvedTripleStatus: ApprovedTripleStatusState;
  minDeposit: bigint | null;
  atomCost: bigint | null;
  tripleCost: bigint | null;
  publishedPosts: { id: string }[];
  isPublishing: boolean;
  publishError: string | null;
  walletConnected: boolean;
  correctChain: boolean;
  contextDirty: boolean;
  draftPosts: DraftPost[];
  visibleNestedProposals: NestedProposalDraft[];
  displayNestedProposals: NestedProposalDraft[];
  mainRefByDraft: Map<string, MainRef | null>;
  proposals: ProposalDraft[];
  derivedTriples: DerivedTripleDraft[];
  nestedRefLabels: Map<string, string>;
  extractionJob: { status: string } | null;
  parentPostId?: string | null;
  parentMainTripleTermId?: string | null;
  themeAtomTermId?: string | null;
  parentClaim?: string | null;
  resolvedAtomMap?: Map<string, string>;
  onConnect: () => void;
  onBack: () => void;
  publishOnchain: () => void;
  switchToCorrectChain?: (() => void) | null;
};

export type TripleInfo = {
  proposal: ApprovedProposalWithRole;
  isExisting: boolean;
  tripleTermId: string | null;
};

export type TripleSummary = {
  triples: TripleInfo[];
  existingTriples: TripleInfo[];
  newTriples: TripleInfo[];
};

export type AtomSummary = {
  atoms: AtomInfo[];
  newAtoms: AtomInfo[];
  existingAtoms: AtomInfo[];
};

export type PreviewModel = {
  viewState: ViewState;
  atomSummary: AtomSummary;
  tripleSummary: TripleSummary;
  totalEstimate: bigint | null;
  costReady: boolean;
  existingTripleCount: number;
  contextCount: number;
  tagTripleCount: number;
  nestedEdgesByDraft: Map<string, NestedProposalDraft[]>;
  ctaLabel: string;
  ctaDisabled: boolean;
  ctaAction: () => void;
  checks: Check[];
  allChecksOk: boolean;
  extractionComplete: boolean;
  currencySymbol: string;
  directMainProposalIds: Set<string>;
  mainNestedCount: number;
  publishPlan: PublishPlan;
  orphanedKeys: Set<string>;
  hasBlockingOrphans: boolean;
};

export function usePreviewModel(inputs: PreviewModelInputs): PreviewModel {
  const {
    approvedProposals,
    approvedTripleStatuses,
    approvedTripleStatus,
    minDeposit,
    atomCost,
    tripleCost,
    publishedPosts,
    isPublishing,
    publishError,
    walletConnected,
    correctChain,
    contextDirty,
    draftPosts,
    visibleNestedProposals,
    displayNestedProposals,
    mainRefByDraft,
    proposals,
    derivedTriples,
    nestedRefLabels,
    extractionJob,
    parentPostId,
    parentMainTripleTermId,
    themeAtomTermId,
    parentClaim,
    resolvedAtomMap,
    onConnect,
    onBack,
    publishOnchain,
    switchToCorrectChain,
  } = inputs;

  const currencySymbol = intuitionTestnet.nativeCurrency.symbol;
  const extractionComplete = Boolean(extractionJob && extractionJob.status !== "pending");

  const viewState: ViewState = publishedPosts.length > 0
    ? "success"
    : isPublishing
      ? "publishing"
      : publishError
        ? "error"
        : "preview";

  const contextCount = visibleNestedProposals.length + derivedTriples.length;

  const publishPlan = useMemo(
    () =>
      buildPublishPlan({
        approvedProposals,
        draftPosts,
        nestedProposals: visibleNestedProposals,
        mainRefByDraft,
        parentPostId,
        parentMainTripleTermId,
        themeAtomTermId,
      }),
    [
      approvedProposals,
      draftPosts,
      visibleNestedProposals,
      mainRefByDraft,
      parentPostId,
      parentMainTripleTermId,
      themeAtomTermId,
    ],
  );
  const { publishableProposals, invalidProposals } = publishPlan;

  const atomSummary = useMemo(() => {
    const seen = new Set<string>();
    const atoms: AtomInfo[] = [];
    for (const ap of publishableProposals) {
      for (const entry of [
        { label: ap.sText, atomId: ap.subjectAtomId, matched: ap.subjectMatchedLabel },
        { label: ap.pText, atomId: ap.predicateAtomId, matched: ap.predicateMatchedLabel },
        { label: ap.oText, atomId: ap.objectAtomId, matched: ap.objectMatchedLabel },
      ]) {
        const key = entry.atomId ?? entry.label;
        if (!seen.has(key)) {
          seen.add(key);
          atoms.push({
            label: entry.label,
            isExisting: Boolean(entry.atomId),
            matchedLabel: safeDisplayLabel(entry.matched, "") || null,
          });
        }
      }
    }

    for (const dt of derivedTriples) {
      for (const label of [dt.subject, dt.predicate, dt.object]) {
        if (!seen.has(label)) {
          seen.add(label);
          const normalized = normalizeLabelForChain(label);
          const resolvedId = resolvedAtomMap?.get(normalized);
          atoms.push({ label, isExisting: Boolean(resolvedId), matchedLabel: null });
        }
      }
    }

    for (const ne of visibleNestedProposals) {
      if (!seen.has(ne.predicate)) {
        seen.add(ne.predicate);
        const normalized = normalizeLabelForChain(ne.predicate);
        const resolvedId = resolvedAtomMap?.get(normalized);
        atoms.push({ label: ne.predicate, isExisting: Boolean(resolvedId), matchedLabel: null });
      }
      for (const ref of [ne.subject, ne.object]) {
        if (ref.type === "atom" && !seen.has(ref.label)) {
          seen.add(ref.label);
          const normalized = normalizeLabelForChain(ref.label);
          const resolvedId = resolvedAtomMap?.get(normalized);
          atoms.push({ label: ref.label, isExisting: Boolean(resolvedId), matchedLabel: null });
        }
      }
    }
    return {
      atoms,
      newAtoms: atoms.filter((a) => !a.isExisting),
      existingAtoms: atoms.filter((a) => a.isExisting),
    };
  }, [publishableProposals, derivedTriples, visibleNestedProposals, resolvedAtomMap]);

  const tripleSummary = useMemo(() => {
    const statusMap = new Map(approvedTripleStatuses.map((s) => [s.proposalId, s]));
    const triples = publishableProposals.map((proposal) => {
      const status = statusMap.get(proposal.id);
      return {
        proposal,
        isExisting: status?.isExisting ?? false,
        tripleTermId: status?.tripleTermId ?? null,
      };
    });
    return {
      triples,
      existingTriples: triples.filter((t) => t.isExisting),
      newTriples: triples.filter((t) => !t.isExisting),
    };
  }, [publishableProposals, approvedTripleStatuses]);

  const { directMainProposalIds, mainNestedIds } = useMemo(
    () => computeEffectiveMainTargets(draftPosts, mainRefByDraft),
    [draftPosts, mainRefByDraft],
  );

  const existingDirectMainCount = tripleSummary.existingTriples
    .filter((t) => directMainProposalIds.has(t.proposal.id)).length;
  const existingTripleCount = tripleSummary.existingTriples.length;

  const newDirectMainCount = tripleSummary.newTriples
    .filter((t) => directMainProposalIds.has(t.proposal.id)).length;
  const newNonMainCoreCount = tripleSummary.newTriples.length - newDirectMainCount;

  const newNestedMainCount = mainNestedIds.size;
  const newNonMainNestedCount = Math.max(0, visibleNestedProposals.length - newNestedMainCount);

  const newDerivedCount = derivedTriples.length;

  const costReady = atomCost !== null && tripleCost !== null && minDeposit !== null && approvedTripleStatus === "ready";

  const totalEstimate = useMemo(() => {
    if (!costReady || !atomCost || !tripleCost || !minDeposit) return null;

    const newAtomTotal = atomCost * BigInt(atomSummary.newAtoms.length);
    const mainTotal = (tripleCost + minDeposit) * BigInt(newDirectMainCount + newNestedMainCount);
    const nonMainTotal = tripleCost * BigInt(newNonMainCoreCount + newNonMainNestedCount + newDerivedCount);
    const stanceTotal = tripleCost * BigInt(publishPlan.metadata.stanceEntries.length);
    const tagTotal = tripleCost * BigInt(publishPlan.metadata.tagEntries.length);
    const existingMainTotal = minDeposit * BigInt(existingDirectMainCount);

    return newAtomTotal + mainTotal + nonMainTotal + stanceTotal + tagTotal + existingMainTotal;
  }, [
    costReady,
    atomCost,
    tripleCost,
    minDeposit,
    atomSummary.newAtoms.length,
    newDirectMainCount,
    newNestedMainCount,
    newNonMainCoreCount,
    newNonMainNestedCount,
    newDerivedCount,
    publishPlan.metadata.stanceEntries.length,
    publishPlan.metadata.tagEntries.length,
    existingDirectMainCount,
  ]);

  const nonRejectedProposals = useMemo(
    () => proposals.filter((p) => p.status !== "rejected"),
    [proposals],
  );

  const { byDraft: nestedEdgesByDraft, orphanedKeys } = useMemo(
    () => assignNestedToDrafts(displayNestedProposals, draftPosts, nonRejectedProposals, derivedTriples),
    [displayNestedProposals, draftPosts, nonRejectedProposals, derivedTriples],
  );

  const hasBlockingOrphans = useMemo(() => {
    if (orphanedKeys.size === 0) return false;
    for (const draft of draftPosts) {
      const ref = mainRefByDraft.get(draft.id);
      if (ref?.type === "nested" && orphanedKeys.has(ref.nestedStableKey)) return true;
    }
    const approvedStableKeys = new Set(
      proposals.filter((p) => p.status === "approved").map((p) => p.stableKey),
    );
    for (const edge of displayNestedProposals) {
      if (!orphanedKeys.has(edge.stableKey)) continue;
      for (const ref of [edge.subject, edge.object]) {
        if (ref.type === "triple" && approvedStableKeys.has(ref.tripleKey)) return true;
      }
    }
    return false;
  }, [orphanedKeys, draftPosts, mainRefByDraft, displayNestedProposals, proposals]);

  const hasIrrelevantContent = useMemo(() => {
    const nestedSubKeys = new Set<string>();
    for (const edge of displayNestedProposals) {
      for (const ref of [edge.subject, edge.object]) {
        if (ref.type === "triple") nestedSubKeys.add(ref.tripleKey);
      }
    }

    const draftProposalIds = new Set(draftPosts.flatMap((d) => d.proposalIds));
    for (const ap of publishableProposals) {
      if (!draftProposalIds.has(ap.id)) continue;
      const proposal = proposals.find((p) => p.id === ap.id);
      if (proposal?.stableKey && nestedSubKeys.has(proposal.stableKey)) continue;
      const body = getReferenceBodyForProposal(ap.id, draftPosts);
      if (!body) return true;
      const sCheck = validateAtomRelevance(ap.sText, body, "sText");
      const oCheck = validateAtomRelevance(ap.oText, body, "oText");
      const nestedCtx = proposal?.stableKey
        ? buildNestedEdgeContexts(proposal.stableKey, displayNestedProposals, nestedRefLabels)
        : [];
      const tripleCheck = checkMeaningPreservation(body, {
        subject: ap.sText, predicate: ap.pText, object: ap.oText,
      }, nestedCtx);
      if (!isAllowed(sCheck) || !isAllowed(oCheck) || !isAllowed(tripleCheck)) return true;
    }
    for (const draft of draftPosts) {
      const ref = mainRefByDraft.get(draft.id);
      if (ref?.type !== "nested") continue;
      const chainLabel = nestedRefLabels.get(ref.nestedStableKey);
      if (!chainLabel) continue;
      const body = draft.body;
      if (!body) return true;
      const labelCheck = checkChainLabelMeaning(body, chainLabel);
      if (!isAllowed(labelCheck)) {
        console.warn("[semantic-validation] BLOCKED chain label", { chainLabel, body, labelCheck });
        return true;
      }
    }
    return false;
  }, [publishableProposals, draftPosts, mainRefByDraft, nestedRefLabels, proposals, displayNestedProposals]);

  const checks: Check[] = [
    { ok: walletConnected, label: labels.connectWalletToPublish, okLabel: "Wallet connected" },
    { ok: correctChain, label: labels.wrongNetworkWarning, okLabel: "Correct network" },
    { ok: !contextDirty, label: labels.contentChangedWarning, okLabel: "Content up to date" },
    { ok: publishPlan.errors.length === 0, label: "Main/metadata references are unresolved", okLabel: "Main/metadata references resolved" },
    { ok: invalidProposals.length === 0, label: "Some claims have empty terms — edit them before publishing", okLabel: "All claims valid" },
    { ok: !hasIrrelevantContent, label: "Some terms don't match the post text", okLabel: "All terms match" },
    { ok: !hasBlockingOrphans, label: "Some nested edges couldn't be assigned to any post", okLabel: "All nested edges assigned" },
  ];
  const allChecksOk = checks.every((c) => c.ok);

  let ctaLabel: string;
  let ctaDisabled = false;
  let ctaAction: () => void;

  if (!walletConnected) {
    ctaLabel = "Connect wallet";
    ctaAction = onConnect;
  } else if (!correctChain) {
    ctaLabel = labels.switchNetworkButton;
    ctaAction = switchToCorrectChain ?? (() => {});
  } else if (contextDirty) {
    ctaLabel = "Content changed — go back";
    ctaAction = onBack;
  } else if (approvedTripleStatus === "checking") {
    ctaLabel = "Resolving\u2026";
    ctaDisabled = true;
    ctaAction = () => {};
  } else {
    const costSuffix = totalEstimate !== null && totalEstimate > 0n
      ? ` \u00B7 ~${formatCost(totalEstimate)} ${currencySymbol}`
      : "";
    ctaLabel = draftPosts.length > 1
      ? `Publish ${draftPosts.length} posts${costSuffix}`
      : `Publish${costSuffix}`;
    const hasMain = approvedProposals.some((p) => p.role === "MAIN") ||
      [...mainRefByDraft.values()].some((ref) => ref?.type === "nested");
    ctaDisabled = isCtaDisabled(approvedProposals.length, hasMain, checks);
    ctaAction = publishOnchain;
  }

  return {
    viewState,
    atomSummary,
    tripleSummary,
    totalEstimate,
    costReady,
    existingTripleCount,
    contextCount,
    tagTripleCount: publishPlan.metadata.tagEntries.length,
    nestedEdgesByDraft,
    ctaLabel,
    ctaDisabled,
    ctaAction,
    checks,
    allChecksOk,
    extractionComplete,
    currencySymbol,
    directMainProposalIds,
    mainNestedCount: mainNestedIds.size,
    publishPlan,
    orphanedKeys,
    hasBlockingOrphans,
  };
}
