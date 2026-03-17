export * from "./types.js";
export { runExtraction } from "./runExtraction.js";
export type { SearchFn, AtomCandidate, AtomMatch } from "./search/types.js";
export {
  canonicalize,
  canonicalizeForMatch,
  scoreCandidate,
  scoreCandidateWithContext,
  preservesPredicateStructure,
  checkMeaningPreservation,
  consensusCompare,
  compareScoredCandidates,
} from "./search/atomSearch.js";
export type { MeaningPreservation } from "./search/atomSearch.js";
export { atomKeyFromLabel } from "./core.js";
export type { NestedEdge, NestedEdgeKind, TermRef, TermRefId } from "./core.js";
