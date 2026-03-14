import type { DecomposedClaim } from "../types.js";
import { ensurePeriod, tokenize } from "./text.js";
import { parseCausal } from "./parse.js";
import { trackFallback } from "./fallbackTracker.js";
import {
  CAUSAL_MARKERS_RE,
  TEMPORAL_SINCE_RE,
  NORMATIVE_RE,
  COMPOUND_NOUN_BLOCKLIST_RE,
  AUXILIARIES_RE,
  CAUSAL_COVERAGE_THRESHOLD,
  SHORT_REASON_MAX_WORDS,
  CAUSAL_BEFORE_MIN_WORDS,
} from "./rules/extractionRules.js";

function isSinceTemporal(textFromSince: string): boolean {
  return TEMPORAL_SINCE_RE.test(textFromSince);
}

function isCoveredBySiblings(
  reasonClause: string,
  siblings: DecomposedClaim[],
): boolean {
  const clauseTokens = tokenize(reasonClause);
  if (clauseTokens.length === 0 || siblings.length === 0) return false;
  const allSiblingTokens = new Set<string>();
  for (const s of siblings) {
    for (const t of tokenize(s.text)) allSiblingTokens.add(t);
  }
  const overlap = clauseTokens.filter((t) => allSiblingTokens.has(t)).length;
  return overlap / clauseTokens.length >= CAUSAL_COVERAGE_THRESHOLD;
}

function splitReasonParts(afterMarker: string): string[] | null {
  if (COMPOUND_NOUN_BLOCKLIST_RE.test(afterMarker)) return null;

  const commaRe = /,\s*/;
  const andOrRe = /\b(?:and|or)\b/i;

  let parts: string[];
  if (commaRe.test(afterMarker)) {
    parts = afterMarker.split(commaRe).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      const last = parts[parts.length - 1];
      if (andOrRe.test(last)) {
        const subParts = last.split(andOrRe).map((p) => p.trim()).filter(Boolean);
        parts = [...parts.slice(0, -1), ...subParts];
      }
    }
  } else if (andOrRe.test(afterMarker)) {
    parts = afterMarker.split(andOrRe).map((p) => p.trim()).filter(Boolean);
  } else {
    return null;
  }

  parts = parts.map((p) => p.replace(/[,;:.!?]+$/, "").trim()).filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

function extractLeadingSubject(text: string): string | null {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return null;
  for (let i = 0; i < words.length; i++) {
    if (AUXILIARIES_RE.test(words[i])) {
      if (i === 0) return null;
      return words.slice(0, i).join(" ");
    }
    if (i > 0 && words[i].toLowerCase() === "not") {
      return words.slice(0, i - 1).join(" ") || null;
    }
  }
  return null;
}

function resolveItCoref(parts: string[]): void {
  if (parts.length < 2) return;
  const firstSubject = extractLeadingSubject(parts[0]);
  if (!firstSubject) return;
  for (let i = 1; i < parts.length; i++) {
    if (/^it\s/i.test(parts[i])) {
      parts[i] = parts[i].replace(/^it\s/i, firstSubject + " ");
    }
  }
}

const CLAUSE_AUX_START_RE = /^(?:can|could|will|would|shall|should|must|may|might|do|does|did|is|are|was|were|has|have|had)\b/i;
const NON_VERBAL_START_RE = /^(?:the|a|an|this|that|these|those|it|they|we|you|i|he|she|there)\b/i;

function extractSubjectAuxPrefix(text: string): string | null {
  const m = text.match(
    /^(.+?\b(?:can|could|will|would|shall|should|must|may|might|do|does|did|is|are|was|were|has|have|had)(?:\s+not)?)\b/i,
  );
  return m?.[1]?.trim() || null;
}

function resolveEllipticCoordinatedParts(parts: string[]): void {
  if (parts.length < 2) return;

  const firstSubject = extractLeadingSubject(parts[0]);
  const firstSubjectAux = extractSubjectAuxPrefix(parts[0]);

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;
    if (/^it\s/i.test(part)) continue;

    if (/^[a-z]+ly\b/i.test(part) && firstSubjectAux) {
      parts[i] = `${firstSubjectAux} ${part}`.replace(/\s+/g, " ").trim();
      continue;
    }

    if (CLAUSE_AUX_START_RE.test(part) && firstSubject) {
      parts[i] = `${firstSubject} ${part}`.replace(/\s+/g, " ").trim();
      continue;
    }

    if (firstSubjectAux && !NON_VERBAL_START_RE.test(part)) {
      if (firstSubject && part.toLowerCase().startsWith(firstSubject.toLowerCase())) continue;
      parts[i] = `${firstSubjectAux} ${part}`.replace(/\s+/g, " ").trim();
    }
  }
}

export type CausalTruncateResult =
  | { kind: "truncate"; text: string }
  | { kind: "split-reason"; beforeMarker: string; marker: string; reasons: string[] }
  | null;

export function tryCausalTruncate(
  mainClaim: DecomposedClaim,
  siblingClaims: DecomposedClaim[],
): CausalTruncateResult {
  const text = mainClaim.text;
  const match = CAUSAL_MARKERS_RE.exec(text);
  if (!match) return null;

  const marker = match[1].toLowerCase();
  const markerIndex = match.index;

  if (marker === "since") {
    const fromSince = text.slice(markerIndex).trim();
    if (isSinceTemporal(fromSince)) return null;
  }

  const beforeMarker = text.slice(0, markerIndex).trim();
  const afterMarker = text.slice(markerIndex + match[0].length).trim();

  const beforeWords = beforeMarker.split(/\s+/).filter(Boolean);
  if (beforeWords.length < CAUSAL_BEFORE_MIN_WORDS) return null;

  if (!afterMarker) return null;

  const afterWords = afterMarker.split(/\s+/).filter(Boolean);
  if (afterWords.length <= SHORT_REASON_MAX_WORDS) return null;

  const parts = splitReasonParts(afterMarker);
  if (parts) {
    const cleanBefore = beforeMarker.replace(/[,;:]\s*$/, "").trim();
    resolveItCoref(parts);
    resolveEllipticCoordinatedParts(parts);
    trackFallback("tryCausalTruncate:split-reason");
    return {
      kind: "split-reason",
      beforeMarker: cleanBefore,
      marker,
      reasons: parts.map((p) => ensurePeriod(`${cleanBefore} ${marker} ${p}`)),
    };
  }

  if (NORMATIVE_RE.test(beforeMarker)) return null;

  if (!isCoveredBySiblings(afterMarker, siblingClaims)) return null;

  let truncated = beforeMarker.replace(/[,;:]\s*$/, "").trim();
  if (!truncated.endsWith(".")) truncated += ".";

  return { kind: "truncate", text: truncated };
}

type TaggedClaim = DecomposedClaim & { _source?: "causal-split"; _splitParentId?: number };
type IndexedClaim = DecomposedClaim & { _idx: number };

export function applyCausalPreProcessing(claims: DecomposedClaim[]): DecomposedClaim[] {
  const indexedClaims: IndexedClaim[] = claims.map((c, i) => ({ ...c, _idx: i }));
  let splitParentCounter = 0;
  let nextGroup = Math.max(...indexedClaims.map((cc) => cc.group), -1) + 1;

  const splitRegistry = new Map<number, { siblingIndexes: Set<number>; reasonTexts: string[] }>();

  let processedClaims: (TaggedClaim & { _originIndex: number })[] = indexedClaims.flatMap((c) => {
    if (c.role !== "MAIN") return [{ ...c, _originIndex: c._idx }];
    const siblings = indexedClaims.filter((s) => s._idx !== c._idx);
    const result = tryCausalTruncate(c, siblings);
    if (!result) return [{ ...c, _originIndex: c._idx }];
    if (result.kind === "truncate") return [{ ...c, text: result.text, _originIndex: c._idx }];

    const parentId = ++splitParentCounter;
    splitRegistry.set(parentId, {
      siblingIndexes: new Set(siblings.map((s) => s._idx)),
      reasonTexts: result.reasons.map((r) => {
        const p = parseCausal(r);
        return p ? p.reasonText : r;
      }),
    });

    return result.reasons.map((text) => ({
      ...c, text, group: nextGroup++,
      _source: "causal-split" as const, _splitParentId: parentId, _originIndex: c._idx,
    }));
  });

  if (splitRegistry.size > 0) {
    const claimsToRemove = new Set<number>();

    for (const [, { reasonTexts, siblingIndexes }] of splitRegistry) {
      for (let i = 0; i < processedClaims.length; i++) {
        const c = processedClaims[i];
        if (c._source === "causal-split") continue;
        if (!siblingIndexes.has(c._originIndex)) continue;
        const cTokens = tokenize(c.text);
        if (cTokens.length === 0) continue;

        const isCovered = reasonTexts.some((reason) => {
          const rTokens = new Set(tokenize(reason));
          const overlap = cTokens.filter((t) => rTokens.has(t)).length / cTokens.length;
          return overlap >= CAUSAL_COVERAGE_THRESHOLD;
        });
        if (isCovered) claimsToRemove.add(i);
      }
    }

    if (claimsToRemove.size > 0) {
      processedClaims = processedClaims.filter((_, i) => !claimsToRemove.has(i));
    }
  }

  return processedClaims.map(({ _source, _splitParentId, _originIndex, ...rest }) => rest);
}
