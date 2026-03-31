import type { DraftPost, ProposalDraft, Stance, ProposalStatus, HexString } from "./types";
import { makeDraftId } from "./idPrefixes";

export function asHexId(value: string): HexString | null {
  if (value.startsWith("0x")) {
    return value as HexString;
  }
  return null;
}

export function createInitialDraft(
  id: string,
  stance: Stance | null,
  proposalIds: string[],
  mainProposalId?: string | null,
  bodyDefault?: string,
): DraftPost {
  const bd = bodyDefault ?? "";
  return { id, stance, mainProposalId: mainProposalId ?? null, proposalIds, body: bd, bodyDefault: bd };
}

export function normalizeMain(draft: DraftPost): DraftPost {
  if (draft.mainProposalId && draft.proposalIds.includes(draft.mainProposalId)) {
    return draft;
  }
  return { ...draft, mainProposalId: draft.proposalIds[0] ?? null };
}

export function findDraftIndex(drafts: DraftPost[], proposalId: string): number {
  return drafts.findIndex((d) => d.proposalIds.includes(proposalId));
}

export function splitIntoDrafts(
  sourceDrafts: DraftPost[],
  proposals: ProposalDraft[],
  userStance: Stance | null,
): DraftPost[] {
  const allProposalIds = [...new Set(sourceDrafts.flatMap((d) => d.proposalIds))];
  const activeIds = allProposalIds.filter((pid) => {
    const p = proposals.find((pr) => pr.id === pid);
    return p && p.status !== "rejected";
  });
  return activeIds.map((pid, index) => {
    const proposal = proposals.find((p) => p.id === pid);
    const bodyDefault = (proposal
      ? (proposal.claimText || proposal.sentenceText || `${proposal.sText} ${proposal.pText} ${proposal.oText}`)
      : "").replace(/\.\s*$/, "");
    return {
      id: makeDraftId(index),
      stance: userStance,
      mainProposalId: pid,
      proposalIds: [pid],
      body: bodyDefault,
      bodyDefault,
    };
  });
}

export function mergeDrafts(
  drafts: DraftPost[],
  userStance: Stance | null,
  inputText?: string,
  proposals?: ProposalDraft[],
): DraftPost {
  const raw = drafts.flatMap((d) => d.proposalIds);
  const allProposalIds = proposals
    ? [...new Set(raw)].filter((pid) => {
        const p = proposals.find((pr) => pr.id === pid);
        return p && p.status !== "rejected";
      })
    : [...new Set(raw)];
  const mainFromFirst = drafts[0]?.mainProposalId ?? null;
  const mainProposalId = mainFromFirst && allProposalIds.includes(mainFromFirst)
    ? mainFromFirst
    : allProposalIds[0] ?? null;
  const bodyDefault = inputText ?? "";
  return {
    id: makeDraftId(0),
    stance: drafts[0]?.stance ?? userStance,
    mainProposalId,
    proposalIds: allProposalIds,
    body: bodyDefault,
    bodyDefault,
  };
}

export function decisionToStatus(decision: string): ProposalStatus {
  if (decision === "CREATE_NEW" || decision === "REUSE_EXISTING") return "approved";
  if (decision === "REJECTED") return "rejected";
  return "pending";
}

