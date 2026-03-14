export const DRAFT_PREFIX = "draft-";
export const STANCE_PREFIX = "stance_";

export function isDraftId(id: string): boolean {
  return id.startsWith(DRAFT_PREFIX);
}

export function makeDraftId(suffix: string | number): string {
  return `${DRAFT_PREFIX}${suffix}`;
}

export function isStanceId(id: string): boolean {
  return id.startsWith(STANCE_PREFIX);
}

export function makeStanceId(mainProposalId: string): string {
  return `${STANCE_PREFIX}${mainProposalId}`;
}

export function stanceMainId(stanceId: string): string {
  return stanceId.slice(STANCE_PREFIX.length);
}
