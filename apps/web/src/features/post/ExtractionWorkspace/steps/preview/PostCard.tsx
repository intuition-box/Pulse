import { ProtocolBadge } from "@/components/ProtocolBadge/ProtocolBadge";
import { labels } from "@/lib/vocabulary";

import {
  type ApprovedProposalWithRole,
  type DerivedTripleDraft,
  type DraftPost,
  type MainRef,
  type NestedProposalDraft,
} from "../../extraction";
import { StructuredTripleInline } from "../../components/StructuredTripleInline";
import cardStyles from "./cardStyles.module.css";

import { type HoverTerms } from "./previewTypes";

export type PostCardProps = {
  draft: DraftPost;
  draftIndex: number;
  totalDrafts: number;
  proposals: ApprovedProposalWithRole[];
  nestedEdges: NestedProposalDraft[];
  allNestedProposals: NestedProposalDraft[];
  nestedRefLabels: Map<string, string>;
  derivedTriples?: DerivedTripleDraft[];
  mainRef: MainRef | null;
  stanceRequired: boolean;
  onHover: (terms: HoverTerms | null) => void;
  onRemove?: () => void;
};

export function PostCard({
  draft,
  draftIndex,
  totalDrafts,
  proposals,
  nestedEdges,
  allNestedProposals,
  nestedRefLabels,
  derivedTriples,
  mainRef,
  stanceRequired,
  onHover,
  onRemove,
}: PostCardProps) {
  const draftProposals = proposals.filter((p) =>
    draft.proposalIds.includes(p.id) && p.status === "approved",
  );
  const mainProposal = draftProposals.find((p) => p.id === draft.mainProposalId);

  const misaligned = stanceRequired
    ? draftProposals.find((p) => p.stanceAligned === false && p.isRelevant !== false)
    : null;

  return (
    <div
      className={cardStyles.card}
      data-stance={draft.stance ?? undefined}
      onMouseEnter={() => {
        if (!mainProposal) return;

        const modifierTexts = nestedEdges
          .filter((e) => e.edgeKind === "modifier")
          .map((e) => {
            const objLabel = e.object.type === "atom"
              ? e.object.label
              : nestedRefLabels.get(e.object.tripleKey) ?? "";
            return `${e.predicate} ${objLabel}`.trim();
          })
          .filter(Boolean);

        const hoverTerms: HoverTerms = {
          sText: mainProposal.sText,
          pText: mainProposal.pText,
          oText: mainProposal.oText,
          sentenceText: mainProposal.sentenceText,
          claimText: mainProposal.claimText,
          modifierTexts: modifierTexts.length > 0 ? modifierTexts : undefined,
        };

        if (mainRef?.type === "nested" && mainProposal.outermostMainKey) {
          const mainEdge = allNestedProposals.find(
            (n) => n.stableKey === mainProposal.outermostMainKey,
          );
          const isReferenced = mainEdge && (
            (mainEdge.subject.type === "triple" && mainEdge.subject.tripleKey === mainProposal.stableKey) ||
            (mainEdge.object.type === "triple" && mainEdge.object.tripleKey === mainProposal.stableKey)
          );
          if (!isReferenced) {
            hoverTerms.sText = "";
            hoverTerms.pText = "";
            hoverTerms.oText = "";
          }
        }

        onHover(hoverTerms);
      }}
      onMouseLeave={() => onHover(null)}
    >

      <div className={cardStyles.header}>
        {totalDrafts > 1 && (
          <span className={cardStyles.headerTitle}>
            {labels.draftHeaderPrefix} {draftIndex + 1}
          </span>
        )}
        {onRemove && (
          <button
            type="button"
            className={cardStyles.removeBtn}
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            aria-label="Remove post"
          >
            &#215;
          </button>
        )}
      </div>

      {misaligned && (
        <div className={cardStyles.stanceWarning}>
          <span className={cardStyles.stanceWarningIcon}>&#9888;</span>
          <span>
            {labels.stanceWarningPrefix}{" "}
            {misaligned.stanceReason
              ? misaligned.stanceReason
              : `This claim seems to ${misaligned.suggestedStance === "SUPPORTS" ? "support" : "refute"} the parent, not ${draft.stance === "SUPPORTS" ? "support" : "refute"} it.`}
          </span>
        </div>
      )}

      {draft.body ? (
        <p className={cardStyles.body}>{draft.body}</p>
      ) : (
        <p className={cardStyles.bodyMuted}>No body</p>
      )}

      {mainRef && mainRef.type !== "error" && (
        <div className={cardStyles.actions}>
          <ProtocolBadge />
          <StructuredTripleInline
            target={mainRef}
            proposals={proposals}
            nestedProposals={allNestedProposals}
            nestedRefLabels={nestedRefLabels}
            derivedTriples={derivedTriples}
            wrap
          />
        </div>
      )}

    </div>
  );
}
