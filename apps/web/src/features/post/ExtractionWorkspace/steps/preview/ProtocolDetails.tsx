import { TripleInline } from "@/components/TripleInline/TripleInline";
import { labels } from "@/lib/vocabulary";

import {
  safeDisplayLabel,
  type MainTarget,
  type ApprovedProposalWithRole,
  type ApprovedTripleStatusState,
  type DerivedTripleDraft,
  type DraftPost,
  type MainRef,
  type NestedProposalDraft,
  type ProposalDraft,
} from "../../extraction";
import { StructuredTermInline, StructuredTripleInline } from "../../components/StructuredTripleInline";
import styles from "./protocolDetails.module.css";

import { formatCost, type AtomInfo } from "./previewTypes";

export type StanceInfo = {
  draftIndex: number;
  stance: "SUPPORTS" | "REFUTES";
  mainTarget: MainTarget;
  parentClaimLabel: string;
};

export type TagInfo = {
  draftIndex: number;
  mainTarget: MainTarget;
  themeLabel: string;
};

export type ProtocolDetailsProps = {
  approvedTripleStatus: ApprovedTripleStatusState;
  atomSummary: {
    newAtoms: AtomInfo[];
    existingAtoms: AtomInfo[];
  };
  proposals: ProposalDraft[];
  draftPosts: DraftPost[];
  tripleSummary: {
    newTriples: { proposal: ApprovedProposalWithRole; tripleTermId: string | null }[];
    existingTriples: { proposal: ApprovedProposalWithRole; tripleTermId: string | null }[];
  };
  existingTripleCount: number;
  minDeposit: bigint | null;
  atomCost: bigint | null;
  tripleCost: bigint | null;
  costReady: boolean;
  totalEstimate: bigint | null;
  stanceRequired: boolean;
  tagTripleCount: number;
  draftPostCount: number;
  totalContextCount: number;
  nestedEdges: NestedProposalDraft[];
  nestedRefLabels: Map<string, string>;
  derivedTriples: DerivedTripleDraft[];
  currencySymbol: string;

  stanceTriples?: StanceInfo[];

  tagTriples?: TagInfo[];

  directMainProposalIds?: Set<string>;

  mainNestedCount?: number;
  mainRefByDraft: Map<string, MainRef | null>;
};

export function ProtocolDetails({
  approvedTripleStatus,
  atomSummary,
  proposals,
  draftPosts,
  tripleSummary,
  existingTripleCount,
  minDeposit,
  atomCost,
  tripleCost,
  costReady,
  totalEstimate,
  stanceRequired,
  tagTripleCount,
  draftPostCount,
  totalContextCount,
  nestedEdges,
  nestedRefLabels,
  derivedTriples,
  currencySymbol,
  stanceTriples,
  tagTriples,
  directMainProposalIds,
  mainNestedCount = 0,
  mainRefByDraft,
}: ProtocolDetailsProps) {
  const newTermCount = atomSummary.newAtoms.length;
  const newClaimCount = tripleSummary.newTriples.length;

  const stanceClaimCount = stanceTriples?.length ?? (stanceRequired ? draftPostCount : 0);
  const effectiveTagCount = tagTriples?.length ?? tagTripleCount;
  const totalNewClaims = newClaimCount + stanceClaimCount + effectiveTagCount + totalContextCount;
  const newTermCost = costReady && atomCost ? atomCost * BigInt(newTermCount) : null;

  const newClaimCost = (() => {
    if (!costReady || !tripleCost || !minDeposit) return null;
    if (directMainProposalIds) {
      const newDirectMainCount = tripleSummary.newTriples
        .filter((t) => directMainProposalIds.has(t.proposal.id)).length;
      const newNonMainCoreCount = newClaimCount - newDirectMainCount;
      const newNonMainNestedCount = Math.max(0, nestedEdges.length - mainNestedCount);
      const mainTotal = (tripleCost + minDeposit) * BigInt(newDirectMainCount + mainNestedCount);
      const nonMainTotal = tripleCost * BigInt(newNonMainCoreCount + newNonMainNestedCount + derivedTriples.length);
      const metaTotal = tripleCost * BigInt(stanceClaimCount + effectiveTagCount);
      return mainTotal + nonMainTotal + metaTotal;
    }

    return (tripleCost + minDeposit) * BigInt(totalNewClaims);
  })();

  const existingMainTripleCount = directMainProposalIds
    ? tripleSummary.existingTriples.filter((t) => directMainProposalIds.has(t.proposal.id)).length
    : tripleSummary.existingTriples.length;
  const existingCost = costReady && minDeposit ? minDeposit * BigInt(existingMainTripleCount) : null;

  const summaryLabel = approvedTripleStatus === "checking"
    ? "Resolving\u2026"
    : "See details";

  const existingProposalIds = new Set(tripleSummary.existingTriples.map((t) => t.proposal.id));

  const mainTargets = draftPosts.flatMap((draft, draftIndex) => {
    const ref = mainRefByDraft.get(draft.id);
    if (!ref || ref.type === "error") return [];
    if (ref.type === "proposal" && existingProposalIds.has(ref.id)) return [];
    const mainTarget: MainTarget = ref.type === "proposal"
      ? { type: "proposal", id: ref.id }
      : { type: "nested", nestedId: ref.nestedId, nestedStableKey: ref.nestedStableKey };
    return [{ draftId: draft.id, draftIndex, mainTarget }];
  });

  const mainOuterNestedKeys = new Set<string>(
    mainTargets
      .filter((e) => e.mainTarget.type === "nested")
      .map((e) => (e.mainTarget as { type: "nested"; nestedStableKey: string }).nestedStableKey),
  );

  const nestedSubTripleKeys = new Set<string>();
  for (const edge of nestedEdges) {
    for (const ref of [edge.subject, edge.object]) {
      if (ref.type === "triple") nestedSubTripleKeys.add(ref.tripleKey);
    }
  }

  const supportingCoreTriples = tripleSummary.newTriples.filter((t) => {
    if (directMainProposalIds?.has(t.proposal.id)) return false;
    if (nestedSubTripleKeys.has(t.proposal.stableKey)) return false;
    return true;
  });
  const supportingNestedEdges = nestedEdges.filter((edge) => !mainOuterNestedKeys.has(edge.stableKey));

  // Derived triples that are also proposals would appear twice — filter them
  const proposalStableKeys = new Set(proposals.map((p) => p.stableKey));
  const orphanDerivedTriples = derivedTriples.filter((dt) => !proposalStableKeys.has(dt.stableKey));

  const displayedClaimCount = mainTargets.length + supportingCoreTriples.length + supportingNestedEdges.length + orphanDerivedTriples.length;

  return (
    <details className={styles.protocolDetails}>
      <summary className={styles.protocolSummary}>{summaryLabel}</summary>
      <div className={styles.protocolContent}>
        {approvedTripleStatus === "error" && (
          <p className={styles.pdError}>Resolution failed</p>
        )}

        <div className={styles.pdFees}>

          {newTermCost !== null && newTermCost > 0n && (
            <details className={styles.pdFeeLine}>
              <summary className={styles.pdFeeLineSummary}>
                New terms ({newTermCount})
                <em className={styles.pdFeeValue}>{formatCost(newTermCost)} {currencySymbol}</em>
              </summary>
              <ul className={styles.pdFeeDetail}>
                {atomSummary.newAtoms.map((a, i) => (
                  <li key={i}>{a.label}</li>
                ))}
              </ul>
            </details>
          )}

          {newClaimCost !== null && totalNewClaims > 0 && (
            <details className={styles.pdFeeLine}>
              <summary className={styles.pdFeeLineSummary}>
                New claims ({totalNewClaims})
                <em className={styles.pdFeeValue}>{formatCost(newClaimCost)} {currencySymbol}</em>
              </summary>

              {displayedClaimCount > 0 && (
                <details className={styles.pdSubSection} open>
                  <summary className={styles.pdSubSummary}>
                    {labels.publishedClaimsLabel} ({displayedClaimCount})
                  </summary>
                  <ul className={styles.pdFeeDetail}>
                    {mainTargets.map((entry) => (
                      <li key={`main-${entry.draftId}`}>
                        <StructuredTripleInline
                          target={entry.mainTarget}
                          proposals={proposals}
                          nestedProposals={nestedEdges}
                          nestedRefLabels={nestedRefLabels}
                          derivedTriples={derivedTriples}
                          nested
                          wrap
                        />
                      </li>
                    ))}
                    {supportingCoreTriples.map((t, i) => (
                      <li key={`core-${i}`}>
                        <TripleInline
                          subject={safeDisplayLabel(t.proposal.subjectMatchedLabel, t.proposal.sText)}
                          predicate={safeDisplayLabel(t.proposal.predicateMatchedLabel, t.proposal.pText)}
                          object={safeDisplayLabel(t.proposal.objectMatchedLabel, t.proposal.oText)}
                          nested
                          wrap
                        />
                      </li>
                    ))}
                    {supportingNestedEdges.map((edge) => (
                      <li key={edge.id}>
                        <TripleInline
                          subject={<StructuredTermInline termRef={edge.subject} proposals={proposals} nestedProposals={nestedEdges} nestedRefLabels={nestedRefLabels} derivedTriples={derivedTriples} />}
                          predicate={edge.predicate}
                          object={<StructuredTermInline termRef={edge.object} proposals={proposals} nestedProposals={nestedEdges} nestedRefLabels={nestedRefLabels} derivedTriples={derivedTriples} />}
                          nested
                          wrap
                        />
                      </li>
                    ))}
                    {orphanDerivedTriples.map((dt) => (
                      <li key={dt.stableKey}>
                        <TripleInline
                          subject={dt.subject}
                          predicate={dt.predicate}
                          object={dt.object}
                          nested
                          wrap
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {(stanceClaimCount > 0 || effectiveTagCount > 0) && (
                <details className={styles.pdSubSection}>
                  <summary className={styles.pdSubSummary}>
                    {labels.metadataLabel} ({stanceClaimCount + effectiveTagCount})
                  </summary>
                  <ul className={styles.pdFeeDetail}>
                    {stanceTriples?.map((st) => (
                      <li key={`stance-${st.draftIndex}`}>
                        <TripleInline
                          subject={(
                            <StructuredTripleInline
                              target={st.mainTarget}
                              proposals={proposals}
                              nestedProposals={nestedEdges}
                              nestedRefLabels={nestedRefLabels}
                              derivedTriples={derivedTriples}
                              nested
                            />
                          )}
                          predicate={st.stance === "SUPPORTS" ? "supports" : "refutes"}
                          object={st.parentClaimLabel}
                          objectNested
                          wrap
                        />
                      </li>
                    ))}
                    {tagTriples?.map((tt) => (
                      <li key={`tag-${tt.draftIndex}`}>
                        <TripleInline
                          subject={(
                            <StructuredTripleInline
                              target={tt.mainTarget}
                              proposals={proposals}
                              nestedProposals={nestedEdges}
                              nestedRefLabels={nestedRefLabels}
                              derivedTriples={derivedTriples}
                              nested
                            />
                          )}
                          predicate="has tag"
                          object={tt.themeLabel}
                          wrap
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </details>
          )}

          {existingTripleCount > 0 && (
            <details className={styles.pdFeeLine}>
              <summary className={styles.pdFeeLineSummary}>
                Existing claims ({existingTripleCount})
                <em className={styles.pdFeeValue}>{existingCost !== null && existingCost > 0n ? formatCost(existingCost) : "0"} {currencySymbol}</em>
              </summary>
              <ul className={styles.pdFeeDetail}>
                {tripleSummary.existingTriples.map((t, i) => (
                  <li key={i}>
                    <TripleInline
                      subject={safeDisplayLabel(t.proposal.subjectMatchedLabel, t.proposal.sText)}
                      predicate={safeDisplayLabel(t.proposal.predicateMatchedLabel, t.proposal.pText)}
                      object={safeDisplayLabel(t.proposal.objectMatchedLabel, t.proposal.oText)}
                      nested
                      wrap
                    />
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className={styles.pdFeeLineStatic}>
            {labels.gasFees}
            <em className={styles.pdFeeValue}>&lt; 0.01 {currencySymbol}</em>
          </div>

          {totalEstimate !== null && totalEstimate > 0n && (
            <div className={`${styles.pdFeeLineStatic} ${styles.pdFeesTotal}`}>
              Total
              <em className={styles.pdFeeValue}>~{formatCost(totalEstimate)} {currencySymbol}</em>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
