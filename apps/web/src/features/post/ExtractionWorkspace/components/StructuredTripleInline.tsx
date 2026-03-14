import type { ReactNode } from "react";

import { TripleInline } from "@/components/TripleInline/TripleInline";
import tripleStyles from "@/components/TripleInline/TripleInline.module.css";

import {
  resolveNestedRefLabel,
  safeDisplayLabel,
  type MainRef,
  type MainTarget,
  type NestedProposalDraft,
  type NestedTermRef,
  type ProposalDraft,
} from "../extraction";

type ProposalLike = Pick<
  ProposalDraft,
  | "id"
  | "stableKey"
  | "sText"
  | "pText"
  | "oText"
  | "subjectMatchedLabel"
  | "predicateMatchedLabel"
  | "objectMatchedLabel"
>;

type StructuredTarget = MainRef | MainTarget;

type StructuredTripleInlineProps = {
  target: StructuredTarget;
  proposals: ProposalLike[];
  nestedProposals: NestedProposalDraft[];
  nestedRefLabels: Map<string, string>;
  wrap?: boolean;
  nested?: boolean;
};

type RenderContext = {
  proposalById: Map<string, ProposalLike>;
  proposalByStableKey: Map<string, ProposalLike>;
  nestedById: Map<string, NestedProposalDraft>;
  nestedByStableKey: Map<string, NestedProposalDraft>;
  nestedRefLabels: Map<string, string>;
};

function renderProposalTriple(
  proposal: ProposalLike,
  wrap: boolean | undefined,
  nested: boolean,
): ReactNode {
  return (
    <TripleInline
      subject={safeDisplayLabel(proposal.subjectMatchedLabel, proposal.sText)}
      predicate={safeDisplayLabel(proposal.predicateMatchedLabel, proposal.pText)}
      object={safeDisplayLabel(proposal.objectMatchedLabel, proposal.oText)}
      wrap={wrap}
      nested={nested}
    />
  );
}

function renderNestedTerm(
  ref: NestedTermRef,
  ctx: RenderContext,
  seen: Set<string>,
): ReactNode {
  if (ref.type === "atom") {
    return resolveNestedRefLabel(ref, ctx.nestedRefLabels);
  }

  if (seen.has(ref.tripleKey)) {
    return <span className={tripleStyles.nested}>{resolveNestedRefLabel(ref, ctx.nestedRefLabels)}</span>;
  }

  const nextSeen = new Set(seen);
  nextSeen.add(ref.tripleKey);

  const nestedEdge = ctx.nestedByStableKey.get(ref.tripleKey);
  if (nestedEdge) {
    return renderNestedEdge(nestedEdge, ctx, nextSeen, true);
  }

  const proposal = ctx.proposalByStableKey.get(ref.tripleKey);
  if (proposal) {
    return renderProposalTriple(proposal, false, true);
  }

  return <span className={tripleStyles.nested}>{resolveNestedRefLabel(ref, ctx.nestedRefLabels)}</span>;
}

function renderNestedEdge(
  edge: NestedProposalDraft,
  ctx: RenderContext,
  seen: Set<string>,
  nested: boolean,
  wrap?: boolean,
): ReactNode {
  return (
    <TripleInline
      subject={renderNestedTerm(edge.subject, ctx, seen)}
      predicate={edge.predicate}
      object={renderNestedTerm(edge.object, ctx, seen)}
      nested={nested}
      wrap={wrap}
    />
  );
}

function buildContext(
  proposals: ProposalLike[],
  nestedProposals: NestedProposalDraft[],
  nestedRefLabels: Map<string, string>,
): RenderContext {
  return {
    proposalById: new Map(proposals.map((proposal) => [proposal.id, proposal])),
    proposalByStableKey: new Map(proposals.map((proposal) => [proposal.stableKey, proposal])),
    nestedById: new Map(nestedProposals.map((edge) => [edge.id, edge])),
    nestedByStableKey: new Map(nestedProposals.map((edge) => [edge.stableKey, edge])),
    nestedRefLabels,
  };
}

type StructuredTermInlineProps = {
  termRef: NestedTermRef;
  proposals: ProposalLike[];
  nestedProposals: NestedProposalDraft[];
  nestedRefLabels: Map<string, string>;
};

export function StructuredTermInline({
  termRef,
  proposals,
  nestedProposals,
  nestedRefLabels,
}: StructuredTermInlineProps) {
  const ctx = buildContext(proposals, nestedProposals, nestedRefLabels);
  return <>{renderNestedTerm(termRef, ctx, new Set())}</>;
}

export function StructuredTripleInline({
  target,
  proposals,
  nestedProposals,
  nestedRefLabels,
  wrap,
  nested = false,
}: StructuredTripleInlineProps) {
  const ctx = buildContext(proposals, nestedProposals, nestedRefLabels);

  if (target.type === "proposal") {
    const proposal = ctx.proposalById.get(target.id);
    if (!proposal) return null;
    return renderProposalTriple(proposal, wrap, nested);
  }

  const edge = ctx.nestedById.get(target.nestedId) ?? ctx.nestedByStableKey.get(target.nestedStableKey);
  if (!edge) return null;

  return renderNestedEdge(edge, ctx, new Set([edge.stableKey]), nested, wrap);
}
