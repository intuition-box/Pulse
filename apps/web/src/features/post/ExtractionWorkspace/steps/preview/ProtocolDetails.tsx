import { TripleInline } from "@/components/TripleInline/TripleInline";
import { labels } from "@/lib/vocabulary";

import {
  safeDisplayLabel,
  type MainTarget,
  type ApprovedProposalWithRole,
  type ApprovedTripleStatusState,
  type DerivedTripleDraft,
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
};

export function ProtocolDetails({
  approvedTripleStatus,
  atomSummary,
  proposals,
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

  const existingCost = costReady && minDeposit ? minDeposit * BigInt(existingTripleCount) : null;

  const summaryLabel = approvedTripleStatus === "checking"
    ? "Resolving\u2026"
    : "See details";

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

              {(newClaimCount > 0 || nestedEdges.length > 0 || derivedTriples.length > 0) && (
                <details className={styles.pdSubSection} open>
                  <summary className={styles.pdSubSummary}>
                    {labels.publishedClaimsLabel} ({newClaimCount + nestedEdges.length + derivedTriples.length})
                  </summary>
                  <ul className={styles.pdFeeDetail}>
                    {tripleSummary.newTriples.map((t, i) => (
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
                    {nestedEdges.map((edge) => (
                      <li key={edge.id}>
                        <TripleInline
                          subject={<StructuredTermInline termRef={edge.subject} proposals={proposals} nestedProposals={nestedEdges} nestedRefLabels={nestedRefLabels} />}
                          predicate={edge.predicate}
                          object={<StructuredTermInline termRef={edge.object} proposals={proposals} nestedProposals={nestedEdges} nestedRefLabels={nestedRefLabels} />}
                          nested
                          wrap
                        />
                      </li>
                    ))}
                    {derivedTriples.map((dt) => (
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

          {existingCost !== null && existingTripleCount > 0 && (() => {
            const existingMainTriples = directMainProposalIds
              ? tripleSummary.existingTriples.filter((t) => directMainProposalIds.has(t.proposal.id))
              : tripleSummary.existingTriples;
            return (
              <details className={styles.pdFeeLine}>
                <summary className={styles.pdFeeLineSummary}>
                  Existing claims ({existingTripleCount})
                  <em className={styles.pdFeeValue}>{formatCost(existingCost)} {currencySymbol}</em>
                </summary>
                <ul className={styles.pdFeeDetail}>
                  {existingMainTriples.map((t, i) => (
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
            );
          })()}

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
