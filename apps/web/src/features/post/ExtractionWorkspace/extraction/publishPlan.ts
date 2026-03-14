import type { DraftPost, NestedProposalDraft, ProposalDraft, Stance } from "./types";
import type { MainRef } from "./mainRef";

export type PublishPlanErrorCode =
  | "MAIN_REF_MISSING"
  | "PARENT_REF_MISSING"
  | "METADATA_UNRESOLVED";

export type PublishPlanError = {
  code: PublishPlanErrorCode;
  draftId: string;
  message: string;
};

export type MainTarget =
  | { type: "proposal"; id: string }
  | { type: "nested"; nestedId: string; nestedStableKey: string };

export type PublishPlanStanceEntry = {
  draftId: string;
  draftIndex: number;
  mainTarget: MainTarget;
  mainProposalId: string | null;
  stance: Stance;
  parentMainTripleTermId: string;
};

export type PublishPlanTagEntry = {
  draftId: string;
  draftIndex: number;
  mainTarget: MainTarget;
  mainProposalId: string | null;
  themeAtomTermId: string;
};

export type PublishPlanInput = {
  approvedProposals: ProposalDraft[];
  draftPosts: DraftPost[];
  nestedProposals: NestedProposalDraft[];
  mainRefByDraft: Map<string, MainRef | null>;
  parentPostId?: string | null;
  parentMainTripleTermId?: string | null;
  themeAtomTermId?: string | null;
};

export type PublishPlan = {
  publishableProposals: ProposalDraft[];
  syntheticProposals: ProposalDraft[];
  invalidProposals: ProposalDraft[];
  metadata: {
    stanceEntries: PublishPlanStanceEntry[];
    tagEntries: PublishPlanTagEntry[];
  };
  errors: PublishPlanError[];
};

type PublishIntent = {
  publishableProposals: ProposalDraft[];
  syntheticProposals: ProposalDraft[];
  invalidProposals: ProposalDraft[];
};

function isStableKeyReachableFromNestedMain(
  outerKey: string,
  targetKey: string,
  nestedByStableKey: Map<string, NestedProposalDraft>,
): boolean {
  const visited = new Set<string>();
  const queue = [outerKey];
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const edge = nestedByStableKey.get(key);
    if (!edge) continue;
    for (const ref of [edge.subject, edge.object]) {
      if (ref.type !== "triple") continue;
      if (ref.tripleKey === targetKey) return true;
      queue.push(ref.tripleKey);
    }
  }
  return false;
}

export function computePublishIntent(
  approvedProposals: ProposalDraft[],
  draftPosts: DraftPost[],
  nestedProposals: NestedProposalDraft[],
  mainRefByDraft: Map<string, MainRef | null>,
): PublishIntent {
  const proposalToDraft = new Map<string, string>();
  for (const draft of draftPosts) {
    for (const pid of draft.proposalIds) {
      proposalToDraft.set(pid, draft.id);
    }
  }

  const nestedByStableKey = new Map(nestedProposals.map((n) => [n.stableKey, n]));

  const publishable: ProposalDraft[] = [];
  const synthetic: ProposalDraft[] = [];
  const invalid: ProposalDraft[] = [];

  for (const p of approvedProposals) {
    if (p.outermostMainKey) {
      const draftId = proposalToDraft.get(p.id);
      const mainRef = draftId ? mainRefByDraft.get(draftId) : undefined;

      if (draftId && mainRef?.type === "nested") {
        if (nestedByStableKey.has(p.outermostMainKey)) {
          if (isStableKeyReachableFromNestedMain(p.outermostMainKey, p.stableKey, nestedByStableKey)) {
            publishable.push(p);
          } else {
            synthetic.push(p);
          }
          continue;
        }
      }
    }

    if (!p.sText?.trim() || !p.pText?.trim() || !p.oText?.trim()) {
      console.error(`[publishPlan] Empty atom in proposal ${p.id}: s="${p.sText}" p="${p.pText}" o="${p.oText}"`);
      invalid.push(p);
      continue;
    }

    publishable.push(p);
  }

  return { publishableProposals: publishable, syntheticProposals: synthetic, invalidProposals: invalid };
}

function toMainTarget(mainRef: MainRef | null): MainTarget | null {
  if (!mainRef) return null;
  if (mainRef.type === "proposal") return { type: "proposal", id: mainRef.id };
  return { type: "nested", nestedId: mainRef.nestedId, nestedStableKey: mainRef.nestedStableKey };
}

export function buildPublishPlan(input: PublishPlanInput): PublishPlan {
  const {
    approvedProposals,
    draftPosts,
    nestedProposals,
    mainRefByDraft,
    parentPostId,
    parentMainTripleTermId,
    themeAtomTermId,
  } = input;

  const { publishableProposals, syntheticProposals, invalidProposals } = computePublishIntent(
    approvedProposals,
    draftPosts,
    nestedProposals,
    mainRefByDraft,
  );

  const proposalToDraft = new Map<string, string>();
  for (const draft of draftPosts) {
    for (const pid of draft.proposalIds) proposalToDraft.set(pid, draft.id);
  }
  const byStableKey = new Map<string, ProposalDraft[]>();
  for (const p of publishableProposals) {
    const arr = byStableKey.get(p.stableKey) ?? [];
    arr.push(p);
    byStableKey.set(p.stableKey, arr);
  }

  const removedDuplicateIds = new Set<string>();
  for (const [, group] of byStableKey) {
    if (group.length < 2) continue;
    const allNestedMain = group.every((p) => {
      const draftId = proposalToDraft.get(p.id);
      if (!draftId) return false;
      return mainRefByDraft.get(draftId)?.type === "nested";
    });
    if (!allNestedMain) continue;
    for (const duplicate of group.slice(1)) {
      removedDuplicateIds.add(duplicate.id);
    }
  }

  const dedupedPublishable = publishableProposals.filter((p) => !removedDuplicateIds.has(p.id));
  const dedupedSynthetic = [
    ...syntheticProposals,
    ...publishableProposals.filter((p) => removedDuplicateIds.has(p.id)),
  ];

  const errors: PublishPlanError[] = [];
  const stanceEntries: PublishPlanStanceEntry[] = [];
  const tagEntries: PublishPlanTagEntry[] = [];

  const isReply = Boolean(parentPostId);
  const isRoot = !isReply;

  for (const [draftIndex, draft] of draftPosts.entries()) {
    const mainTarget = toMainTarget(mainRefByDraft.get(draft.id) ?? null);
    if (!mainTarget) {
      errors.push({
        code: "MAIN_REF_MISSING",
        draftId: draft.id,
        message: `Missing main reference for draft "${draft.id}".`,
      });
      continue;
    }

    if (isReply && draft.stance) {
      if (!parentMainTripleTermId) {
        errors.push({
          code: "PARENT_REF_MISSING",
          draftId: draft.id,
          message: `Missing parent main triple for stance on draft "${draft.id}".`,
        });
      } else {
        stanceEntries.push({
          draftId: draft.id,
          draftIndex,
          mainTarget,
          mainProposalId: draft.mainProposalId,
          stance: draft.stance,
          parentMainTripleTermId,
        });
      }
    }

    if (isRoot && themeAtomTermId) {
      tagEntries.push({
        draftId: draft.id,
        draftIndex,
        mainTarget,
        mainProposalId: draft.mainProposalId,
        themeAtomTermId,
      });
    }
  }

  return {
    publishableProposals: dedupedPublishable,
    syntheticProposals: dedupedSynthetic,
    invalidProposals,
    metadata: { stanceEntries, tagEntries },
    errors,
  };
}
