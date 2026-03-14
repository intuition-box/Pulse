import type {
  DraftPost,
  ProposalDraft,
  NestedProposalDraft,
  DerivedTripleDraft,
  ResolvedTriple,
  ResolvedNestedTriple,
  DraftPublishPayload,
} from "./types";
import type { MainRef } from "./mainRef";
import { isStanceId, stanceMainId } from "./idPrefixes";
import { buildPublishPlan } from "./publishPlan";

export function assignNestedToDrafts(
  nestedEdges: NestedProposalDraft[],
  draftPosts: DraftPost[],
  proposals: ProposalDraft[],
  derivedTriples?: DerivedTripleDraft[],
): Map<string, NestedProposalDraft[]> {
  const result = new Map<string, NestedProposalDraft[]>();
  for (const d of draftPosts) result.set(d.id, []);

  const proposalToDraft = new Map<string, string>();
  for (const d of draftPosts) for (const pid of d.proposalIds) proposalToDraft.set(pid, d.id);

  const stableKeyToProposalId = new Map<string, string>();
  for (const p of proposals) if (p.stableKey) stableKeyToProposalId.set(p.stableKey, p.id);

  const derivedKeyToDraft = new Map<string, string>();
  if (derivedTriples) {
    for (const dt of derivedTriples) {
      const owner = draftPosts.find((d) =>
        d.proposalIds
          .map((pid) => proposals.find((p) => p.id === pid))
          .some((p) => p?.groupKey === dt.ownerGroupKey),
      );
      if (owner) derivedKeyToDraft.set(dt.stableKey, owner.id);
    }
  }

  const nestedKeyToDraft = new Map<string, string>();
  let remaining = [...nestedEdges];
  const MAX_ROUNDS = 10;
  for (let round = 0; round < MAX_ROUNDS && remaining.length > 0; round++) {
    const prevCount = remaining.length;
    const deferred: NestedProposalDraft[] = [];
    for (const edge of remaining) {
      let draftId: string | undefined;
      if (edge.subject.type === "triple") {
        const pid = stableKeyToProposalId.get(edge.subject.tripleKey);
        if (pid) draftId = proposalToDraft.get(pid);
        if (!draftId) draftId = nestedKeyToDraft.get(edge.subject.tripleKey);
        if (!draftId) draftId = derivedKeyToDraft.get(edge.subject.tripleKey);
      }
      if (!draftId && edge.object.type === "triple") {
        const pid = stableKeyToProposalId.get(edge.object.tripleKey);
        if (pid) draftId = proposalToDraft.get(pid);
        if (!draftId) draftId = nestedKeyToDraft.get(edge.object.tripleKey);
        if (!draftId) draftId = derivedKeyToDraft.get(edge.object.tripleKey);
      }
      const hasTripleRef = edge.subject.type === "triple" || edge.object.type === "triple";
      if (!draftId && hasTripleRef && round < MAX_ROUNDS - 1) {
        deferred.push(edge);
        continue;
      }
      draftId ??= draftPosts[0]?.id;
      if (edge.stableKey && draftId) nestedKeyToDraft.set(edge.stableKey, draftId);
      if (draftId && result.has(draftId)) result.get(draftId)!.push(edge);
    }
    remaining = deferred;
    if (deferred.length === prevCount) break;
  }

  if (remaining.length > 0 && draftPosts[0]) {
    const fallbackId = draftPosts[0].id;
    const bucket = result.get(fallbackId)!;
    const existingKeys = new Set(bucket.map((e) => e.stableKey));
    remaining.sort((a, b) => a.stableKey.localeCompare(b.stableKey));
    for (const edge of remaining) {
      if (!existingKeys.has(edge.stableKey)) {
        if (edge.stableKey) nestedKeyToDraft.set(edge.stableKey, fallbackId);
        bucket.push(edge);
      }
    }
  }

  return result;
}

export function groupResolvedByDraft(
  resolvedByIndex: Array<ResolvedTriple | null>,
  resolvedNestedTriples: ResolvedNestedTriple[],
  draftPosts: DraftPost[],
  proposals: ProposalDraft[],
  nestedProposals: NestedProposalDraft[],
  mainRefByDraft?: Map<string, MainRef | null>,
  derivedTriples?: DerivedTripleDraft[],
): DraftPublishPayload[] {
  const proposalToDraft = new Map<string, string>();
  for (const draft of draftPosts) {
    for (const pid of draft.proposalIds) {
      proposalToDraft.set(pid, draft.id);
    }
  }

  const stableKeyToProposalId = new Map<string, string>();
  for (const p of proposals) {
    if (p.stableKey) stableKeyToProposalId.set(p.stableKey, p.id);
  }

  const payloads = new Map<string, DraftPublishPayload>();
  for (const draft of draftPosts) {
    payloads.set(draft.id, {
      draftId: draft.id,
      body: draft.body,
      stance: draft.stance,
      triples: [],
      nestedTriples: [],
    });
  }

  const approvedProposals = proposals.filter((p) => p.status === "approved");
  const plan = buildPublishPlan({
    approvedProposals,
    draftPosts,
    nestedProposals,
    mainRefByDraft: mainRefByDraft ?? new Map(),
  });
  const { syntheticProposals, invalidProposals } = plan;
  const excludedIds = new Set([
    ...syntheticProposals.map((p) => p.id),
    ...invalidProposals.map((p) => p.id),
  ]);

  for (const t of resolvedByIndex) {
    if (!t) continue;
    if (excludedIds.has(t.proposalId)) continue;
    let draftId: string | undefined;
    if (isStanceId(t.proposalId)) {
      const mainPid = stanceMainId(t.proposalId);
      draftId = proposalToDraft.get(mainPid);
    } else {
      draftId = proposalToDraft.get(t.proposalId);
    }
    if (!draftId) {
      throw new Error(`Cannot assign triple "${t.proposalId}" to any draft — mapping missing.`);
    }

    const draftMainRef = mainRefByDraft?.get(draftId);
    const forceSupporting = draftMainRef?.type === "nested";
    const proposal = proposals.find((p) => p.id === t.proposalId);
    payloads.get(draftId)!.triples.push({
      proposalId: t.proposalId,
      tripleTermId: t.tripleTermId,
      isExisting: t.isExisting,
      role: forceSupporting ? "SUPPORTING" : t.role,
      ...(proposal && !t.isExisting ? { sLabel: proposal.sText, pLabel: proposal.pText, oLabel: proposal.oText } : {}),
    });
  }

  const derivedKeyToDraft = new Map<string, string>();
  if (derivedTriples) {
    for (const dt of derivedTriples) {
      const ownerDraft = draftPosts.find((d) => {
        const draftProposals = d.proposalIds
          .map((pid) => proposals.find((p) => p.id === pid))
          .filter(Boolean);
        return draftProposals.some((p) => p!.groupKey === dt.ownerGroupKey);
      });
      if (ownerDraft) derivedKeyToDraft.set(dt.stableKey, ownerDraft.id);
    }
  }

  const edgeById = new Map(nestedProposals.map((e) => [e.id, e]));
  const nestedKeyToDraft = new Map<string, string>();
  for (const n of resolvedNestedTriples) {
    const edge = edgeById.get(n.nestedProposalId);
    let draftId: string | undefined;
    if (edge) {
      if (edge.subject.type === "triple") {
        const pid = stableKeyToProposalId.get(edge.subject.tripleKey);
        if (pid) draftId = proposalToDraft.get(pid);
        if (!draftId) draftId = nestedKeyToDraft.get(edge.subject.tripleKey);
        if (!draftId) draftId = derivedKeyToDraft.get(edge.subject.tripleKey);
      }
      if (!draftId && edge.object.type === "triple") {
        const pid = stableKeyToProposalId.get(edge.object.tripleKey);
        if (pid) draftId = proposalToDraft.get(pid);
        if (!draftId) draftId = nestedKeyToDraft.get(edge.object.tripleKey);
        if (!draftId) draftId = derivedKeyToDraft.get(edge.object.tripleKey);
      }
    }

    draftId ??= draftPosts[0]?.id;
    if (edge && draftId) nestedKeyToDraft.set(edge.stableKey, draftId);

    const isMainNested = draftId != null && mainRefByDraft?.get(draftId)?.type === "nested"
      && (mainRefByDraft.get(draftId) as { nestedId: string }).nestedId === n.nestedProposalId;

    if (draftId) {
      payloads.get(draftId)!.nestedTriples.push({
        nestedProposalId: n.nestedProposalId,
        tripleTermId: n.tripleTermId,
        isExisting: n.isExisting,
        role: isMainNested ? "MAIN" : "SUPPORTING",
      });
    }
  }

  return draftPosts.map((d) => payloads.get(d.id)!);
}
