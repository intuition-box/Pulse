import { scoreCandidate, preservesPredicateStructure } from "@db/agents";

export type TripleCandidate = {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  holders?: number | null;
};

const SUBJECT_THRESHOLD = 750;
const PREDICATE_THRESHOLD = 900;
const OBJECT_THRESHOLD = 750;

export type TripleMatchResult = {
  termId: string;
  score: number;
  positionCount: number;
} | null;

export function scoreTripleMatch(
  sLabel: string,
  pLabel: string,
  oLabel: string,
  suggestion: TripleCandidate,
): TripleMatchResult {

  if (!preservesPredicateStructure(pLabel, suggestion.predicate)) return null;

  const stub = { termId: "", source: "graphql" as const, marketCap: 0, holders: 0, shares: null, sharePrice: null };
  const sScore = scoreCandidate(sLabel, { ...stub, label: suggestion.subject });
  const pScore = scoreCandidate(pLabel, { ...stub, label: suggestion.predicate });
  const oScore = scoreCandidate(oLabel, { ...stub, label: suggestion.object });

  if (
    sScore < SUBJECT_THRESHOLD ||
    pScore < PREDICATE_THRESHOLD ||
    oScore < OBJECT_THRESHOLD
  )
    return null;

  return {
    termId: suggestion.id,
    score: sScore + pScore + oScore,
    positionCount: suggestion.holders ?? 0,
  };
}

export function pickBestTripleMatch(
  results: TripleMatchResult[],
): TripleMatchResult {
  const valid = results.filter(
    (r): r is NonNullable<TripleMatchResult> => r !== null,
  );
  if (valid.length === 0) return null;
  valid.sort((a, b) => b.score - a.score || b.positionCount - a.positionCount);
  return valid[0];
}
