"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/Button/Button";
import { labels } from "@/lib/vocabulary";

import { RefineChat } from "../components/RefineChat/RefineChat";
import { useTripleVaultMetrics } from "../components/RefineChat/useTripleVaultMetrics";
import { useRefineChat } from "../hooks/useRefineChat";
import { buildReasoningSummaryText } from "../hooks/buildDecisionsData";
import type { UseExtractionFlowResult } from "../hooks/useExtractionFlow";
import styles from "../ExtractionWorkspace.module.css";
import publishStyles from "./preview/publishStates.module.css";
import { PublishStepper } from "./preview/PublishStepper";
import splitStyles from "./preview/splitNotice.module.css";
import gridStyles from "./preview/postGrid.module.css";
import checkStyles from "./preview/checklist.module.css";

import { PostCard } from "./preview/PostCard";
import { ProtocolDetails, type StanceInfo, type TagInfo } from "./preview/ProtocolDetails";
import { useHighlightedText } from "./preview/useHighlightedText";
import { usePreviewModel } from "./preview/usePreviewModel";
import { type HoverTerms } from "./preview/previewTypes";

const SLOT_FIELD_MAP: Record<string, "sText" | "pText" | "oText"> = {
  subject: "sText",
  predicate: "pText",
  object: "oText",
};

type StepPreviewPublishProps = {
  flow: UseExtractionFlowResult;
  chatOpen: boolean;
  onChatOpenChange: (open: boolean) => void;
  onBack: () => void;
  onConnect: () => void;
};

export function StepPreviewPublish({ flow, chatOpen, onChatOpenChange, onBack, onConnect }: StepPreviewPublishProps) {
  const [hoveredTerms, setHoveredTerms] = useState<HoverTerms | null>(null);
  const gridWrapperRef = useRef<HTMLDivElement>(null);

  const handleGridScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atStart = el.scrollLeft < 8;
    const atEnd = el.scrollWidth - el.scrollLeft - el.clientWidth < 8;
    const wrapper = gridWrapperRef.current;
    if (wrapper) {
      if (atStart) wrapper.removeAttribute("data-scroll-start");
      else wrapper.setAttribute("data-scroll-start", "");
      if (atEnd) wrapper.setAttribute("data-scroll-end", "");
      else wrapper.removeAttribute("data-scroll-end");
    }
  }, []);

  const {
    approvedProposals,
    approvedTripleStatus,
    approvedTripleStatusError,
    depositState,
    publishedPosts,
    publishError,
    draftPosts,
    stanceRequired,
    visibleNestedProposals,
    nestedRefLabels,
    extractedInputText,
    proposalCount,
    proposalActions,
    draftActions,
    extractionJob,
    mainRefByDraft,
    proposals,
    publishOnchain,
    resetPublishError,
  } = flow;

  const model = usePreviewModel({
    approvedProposals,
    approvedTripleStatuses: flow.approvedTripleStatuses,
    approvedTripleStatus,
    minDeposit: flow.minDeposit,
    atomCost: flow.atomCost,
    tripleCost: flow.tripleCost,
    publishedPosts,
    isPublishing: flow.isPublishing,
    publishError,
    walletConnected: flow.walletConnected,
    correctChain: flow.correctChain,
    contextDirty: flow.contextDirty,
    draftPosts,
    visibleNestedProposals,
    displayNestedProposals: flow.displayNestedProposals,
    mainRefByDraft,
    proposals,
    derivedTriples: flow.derivedTriples,
    extractionJob,
    parentPostId: extractionJob?.parentPostId ?? null,
    parentMainTripleTermId: flow.parentMainTripleTermId ?? null,
    themeAtomTermId: flow.themeAtomTermId ?? null,
    parentClaim: flow.parentClaim,
    resolvedAtomMap: flow.resolvedAtomMap,
    onConnect,
    onBack,
    publishOnchain,
    switchToCorrectChain: flow.switchToCorrectChain,
  });

  const proposalPostMap = useMemo(() => {
    const map = new Map<string, number>();
    draftPosts.forEach((draft, i) => {
      for (const pid of draft.proposalIds) map.set(pid, i + 1);
    });
    return map;
  }, [draftPosts]);

  const chatProposals = useMemo(() => {
    const core = proposals
      .filter((p) => p.status !== "rejected")
      .map((p) => {
        const draft = draftPosts.find((d) => d.proposalIds.includes(p.id));
        const mainRef = draft ? mainRefByDraft.get(draft.id) : null;
        const effectiveRole = mainRef?.type === "nested"
          ? "SUPPORTING" as const
          : (draft && p.id === draft.mainProposalId ? "MAIN" as const : "SUPPORTING" as const);
        return {
          id: p.id,
          sText: p.subjectMatchedLabel || p.sText,
          pText: p.predicateMatchedLabel || p.pText,
          oText: p.objectMatchedLabel || p.oText,
          role: effectiveRole,
          postNumber: proposalPostMap.get(p.id),
        };
      });

    const nestedPseudo = visibleNestedProposals.map((edge) => {
      const resolveRef = (ref: typeof edge.subject): string => {
        if (ref.type === "atom") return ref.label;
        return nestedRefLabels.get(ref.tripleKey) ?? ref.label ?? "[context]";
      };
      return {
        id: `nested:${edge.id}`,
        sText: resolveRef(edge.subject),
        pText: edge.predicate,
        oText: resolveRef(edge.object),
        role: "SUPPORTING" as const,
        postNumber: undefined,
      };
    });

    return [...core, ...nestedPseudo];
  }, [proposals, draftPosts, mainRefByDraft, proposalPostMap, visibleNestedProposals, nestedRefLabels]);

  const reasoningSummary = useMemo(() => buildReasoningSummaryText(proposals, draftPosts), [proposals, draftPosts]);

  const handlePropagateAtom = useCallback(
    (sourceSlotText: string, atomId: string, label: string) => {
      proposalActions.onPropagateAtom(sourceSlotText, atomId, label);
    },
    [proposalActions],
  );

  const getSlotText = useCallback(
    (proposalId: string, field: "subject" | "predicate" | "object"): string | null => {
      const p = proposals.find((pr) => pr.id === proposalId);
      return p ? p[SLOT_FIELD_MAP[field]] : null;
    },
    [proposals],
  );

  const refineChat = useRefineChat({
    proposals: chatProposals,
    proposalActions,
    draftPosts,
    sourceText: extractedInputText,
    themeTitle: flow.themeTitle,
    parentClaim: flow.parentClaim,
    reasoningSummary,
    onBodyChange: draftActions.onBodyChange,
    onSplit: draftActions.onSplit,
    onUpdateNestedPredicate: flow.updateNestedPredicate,
    onUpdateNestedAtom: flow.updateNestedAtom,
  });

  const existingTripleTermIds = useMemo(
    () =>
      (flow.approvedTripleStatuses ?? [])
        .filter((s) => s.isExisting && s.tripleTermId)
        .map((s) => s.tripleTermId!),
    [flow.approvedTripleStatuses],
  );
  const tripleMetrics = useTripleVaultMetrics(existingTripleTermIds);

  const [parentTripleLabel, setParentTripleLabel] = useState<string | null>(null);
  useEffect(() => {
    setParentTripleLabel(null);
    const termId = flow.parentMainTripleTermId;
    if (!termId) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/triples/${termId}`, { signal: controller.signal });
        if (!res.ok || controller.signal.aborted) return;
        const data = await res.json();
        const t = data?.triple;
        if (t && !controller.signal.aborted) {
          setParentTripleLabel(`${t.subject} · ${t.predicate} · ${t.object}`);
        }
      } catch {

      }
    })();
    return () => controller.abort();
  }, [flow.parentMainTripleTermId]);

  const stanceTriples = useMemo<StanceInfo[]>(() => {
    if (!stanceRequired) return [];
    const parentLabel = parentTripleLabel ?? flow.parentClaim ?? "Parent";
    return model.publishPlan.metadata.stanceEntries.map((entry) => ({
      draftIndex: entry.draftIndex,
      stance: entry.stance,
      mainTarget: entry.mainTarget,
      parentClaimLabel: parentLabel,
    }));
  }, [stanceRequired, parentTripleLabel, flow.parentClaim, model.publishPlan.metadata.stanceEntries]);

  const tagTriples = useMemo<TagInfo[]>(() => {
    if (!flow.themeTitle) return [];
    return model.publishPlan.metadata.tagEntries.map((entry) => ({
      draftIndex: entry.draftIndex,
      mainTarget: entry.mainTarget,
      themeLabel: flow.themeTitle!,
    }));
  }, [flow.themeTitle, model.publishPlan.metadata.tagEntries]);

  const highlightedText = useHighlightedText(extractedInputText, hoveredTerms);
  if (model.viewState === "publishing") {
    return (
      <div className={styles.stepContent}>
        <PublishStepper step={flow.publishStep ?? "preparing"} />
      </div>
    );
  }

  if (model.viewState === "success") {
    const isSingle = publishedPosts.length === 1;
    return (
      <div className={styles.stepContent}>
        <div className={publishStyles.successState}>
          <p className={publishStyles.successIcon}>&#10003;</p>
          <p className={publishStyles.successTitle}>Published!</p>
          <p className={publishStyles.successBody}>
            {isSingle ? labels.successBodySingle : labels.successBody}
          </p>
          {publishedPosts[0] && (
            <>
              <Link href={`/posts/${publishedPosts[0].id}`} className={publishStyles.successLink}>
                View post &rarr;
              </Link>
              <Link href="/explore" className={publishStyles.successLinkSecondary}>
                {labels.publishSuccessCta} &rarr;
              </Link>
            </>
          )}
        </div>
      </div>
    );
  }

  if (model.viewState === "error") {
    return (
      <div className={styles.stepContent}>
        <div className={publishStyles.errorState}>
          <p className={publishStyles.errorIcon}>&#9888;</p>
          <p className={publishStyles.errorTitle}>Publication failed</p>
          <p className={publishStyles.errorMessage}>{publishError}</p>
          <div className={publishStyles.errorActions}>
            <Button variant="primary" size="sm" onClick={publishOnchain}>
              Try again
            </Button>
            <Button variant="outline" size="sm" onClick={resetPublishError}>
              &larr; Back
            </Button>
          </div>
        </div>

        <ProtocolDetails
          approvedTripleStatus={approvedTripleStatus}
          atomSummary={model.atomSummary}
          proposals={proposals}
          tripleSummary={model.tripleSummary}
          existingTripleCount={model.existingTripleCount}
          minDeposit={flow.minDeposit}
          atomCost={flow.atomCost}
          tripleCost={flow.tripleCost}
          costReady={model.costReady}
          totalEstimate={model.totalEstimate}
          stanceRequired={stanceRequired}
          tagTripleCount={model.tagTripleCount}
          draftPostCount={draftPosts.length}
          totalContextCount={model.contextCount}
          nestedEdges={visibleNestedProposals}
          nestedRefLabels={nestedRefLabels}
          derivedTriples={flow.derivedTriples}
          currencySymbol={model.currencySymbol}
          stanceTriples={stanceTriples}
          tagTriples={tagTriples}
        />
      </div>
    );
  }

  const showChat = chatOpen && model.extractionComplete && proposalCount > 0;

  return (
    <div className={styles.previewLayout} data-chat-open={showChat || undefined}>
      <div className={styles.previewMain}>
        <div className={styles.previewScroll}>
          {extractedInputText && (
            <div className={styles.originalTextBlock}>
              <p className={styles.originalTextLabel}>{labels.originalTextLabel}</p>
              <p className={styles.originalText}>
                {highlightedText ? (
                  <>
                    {highlightedText.before}
                    <mark className={styles.highlight}>{highlightedText.match}</mark>
                    {highlightedText.after}
                  </>
                ) : (
                  extractedInputText
                )}
              </p>
            </div>
          )}

          {draftPosts.length > 1 && (
            <div className={splitStyles.splitNotice}>
              <span className={splitStyles.splitNoticeIcon}>&#9998;</span>
              <div className={splitStyles.splitNoticeText}>
                <p className={splitStyles.splitNoticeTitle}>
                  {labels.splitNoticeTitle.replace("{count}", String(draftPosts.length))}
                </p>
                <p className={splitStyles.splitNoticeBody}>{labels.splitNoticeBody}</p>
              </div>
            </div>
          )}

          {model.extractionComplete && proposalCount > 0 && (
            <button
              type="button"
              className={styles.chatToggle}
              onClick={() => onChatOpenChange(!chatOpen)}
            >
              {chatOpen ? labels.refineChatClose : labels.refineChatOpen}
            </button>
          )}

          {approvedProposals.length > 0 && (
            <div
              className={gridStyles.postGridWrapper}
              ref={gridWrapperRef}
              {...(draftPosts.length <= 2 ? { "data-scroll-end": "" } : {})}
            >
              <div className={gridStyles.postGrid} onScroll={handleGridScroll}>
                {draftPosts.map((draft, i) => (
                  <PostCard
                    key={draft.id}
                    draft={draft}
                    draftIndex={i}
                    totalDrafts={draftPosts.length}
                    proposals={approvedProposals}
                    nestedEdges={model.nestedEdgesByDraft.get(draft.id) ?? []}
                    allNestedProposals={visibleNestedProposals}
                    nestedRefLabels={nestedRefLabels}
                    mainRef={mainRefByDraft.get(draft.id) ?? null}
                    stanceRequired={stanceRequired}
                    onHover={setHoveredTerms}
                    onRemove={draftPosts.length > 1 ? () => draftActions.onRemove(draft.id) : undefined}
                  />
                ))}
              </div>
            </div>
          )}

          {approvedProposals.length === 0 && (
            <p className={styles.emptyPlan}>{labels.emptyPlan}</p>
          )}

          {approvedTripleStatus === "error" && approvedTripleStatusError && (
            <div className={styles.tripleNotice}>
              <p className={styles.noticeError}>{approvedTripleStatusError}</p>
            </div>
          )}
          {depositState.status === "confirmed" && (
            <div className={styles.tripleNotice}>
              <p className={styles.noticeSuccess}>
                {labels.depositsConfirmed}
                {depositState.count > 0
                  ? ` for ${depositState.count} ${labels.stepTriples.toLowerCase()}`
                  : ""}
                .
              </p>
            </div>
          )}
          {depositState.status === "failed" && (
            <div className={styles.tripleNotice}>
              <p className={styles.noticeError}>{depositState.error}</p>
            </div>
          )}

          {approvedProposals.length > 0 && (
            <ProtocolDetails
              approvedTripleStatus={approvedTripleStatus}
              atomSummary={model.atomSummary}
              proposals={proposals}
              tripleSummary={model.tripleSummary}
              existingTripleCount={model.existingTripleCount}
              minDeposit={flow.minDeposit}
              atomCost={flow.atomCost}
              tripleCost={flow.tripleCost}
              costReady={model.costReady}
              totalEstimate={model.totalEstimate}
              stanceRequired={stanceRequired}
              tagTripleCount={model.tagTripleCount}
              draftPostCount={draftPosts.length}
              totalContextCount={model.contextCount}
              nestedEdges={visibleNestedProposals}
              nestedRefLabels={nestedRefLabels}
              derivedTriples={flow.derivedTriples}
              currencySymbol={model.currencySymbol}
              stanceTriples={stanceTriples}
              tagTriples={tagTriples}
              directMainProposalIds={model.directMainProposalIds}
              mainNestedCount={model.mainNestedCount}
            />
          )}

          {flow.semanticSkipped && (
            <p className={styles.conservativeHint}>{labels.conservativeEstimateHint}</p>
          )}

          {!model.allChecksOk && (
            <div className={checkStyles.checklist}>
              {model.checks.map((check, i) => (
                <div key={i} className={checkStyles.checkItem}>
                  <span className={checkStyles.checkIcon} data-ok={check.ok}>
                    {check.ok ? "\u2713" : "\u2717"}
                  </span>
                  <span>{check.ok ? check.okLabel : check.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.actions}>
          <Button size="sm" variant="outline" onClick={onBack}>
            &larr; Back
          </Button>
          <Button size="sm" variant="primary" onClick={model.ctaAction} disabled={model.ctaDisabled} style={{ marginLeft: "auto" }}>
            {model.ctaLabel}
          </Button>
        </div>
      </div>

      {showChat && (
        <div className={styles.chatPanel}>
          <RefineChat
            panel
            messages={refineChat.messages}
            isStreaming={refineChat.isStreaming}
            error={refineChat.error}
            onSend={refineChat.sendMessage}
            onAction={refineChat.handleAction}
            onStop={refineChat.stopStreaming}
            onClear={refineChat.clearChat}
            onPropagateAtom={handlePropagateAtom}
            getSlotText={getSlotText}
            proposals={approvedProposals}
            draftPosts={draftPosts}
            nestedEdges={visibleNestedProposals}
            derivedTriples={flow.derivedTriples}
            approvedTripleStatuses={flow.approvedTripleStatuses}
            tripleVaultMetrics={tripleMetrics.data}
            tripleMetricsLoading={tripleMetrics.isLoading}
            tripleMetricsError={tripleMetrics.fetchError}
            searchAtomForEdit={refineChat.searchAtomForEdit}
            onUpdateNestedPredicate={flow.updateNestedPredicate}
            onUpdateNestedAtom={flow.updateNestedAtom}
            onSetNewTermLocal={flow.proposalActions.onSetNewTermLocal}
            resolvedAtomMap={flow.resolvedAtomMap}
          />
        </div>
      )}
    </div>
  );
}
