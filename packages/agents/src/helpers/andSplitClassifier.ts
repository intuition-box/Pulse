

import { looksLikeProposition } from "./parse.js";
import { COMPOUND_NOUN_BLOCKLIST_RE } from "./rules/extractionRules.js";

export type AndSplitResult =
  | { action: "split"; parts: string[] }
  | { action: "keep" };

const TEMPORAL_SINCE_CONTEXT_RE = /\bsince\s+(?:\d|the\s+\d|last\s|early\s|late\s)/i;

function hasCausalMarker(text: string): boolean {
  if (/\bbecause\b/i.test(text)) return true;
  if (/\bsince\b/i.test(text) && !TEMPORAL_SINCE_CONTEXT_RE.test(text)) return true;
  return false;
}

const VERB_RE = /\b(is|are|was|were|has|have|had|do|does|did|can|will|shall|should|must|may|might|could|would)\b|\b(\w+(?:es|ed|[^s]s))\b/i;

function extractSubjectVerb(text: string): { subject: string; verb: string } | null {
  const words = text.trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    if (VERB_RE.test(words[i])) {
      const subject = words.slice(0, i).join(" ");
      if (!subject) continue;
      return { subject, verb: words[i] };
    }
  }
  return null;
}

export function shouldSplitOnAnd(text: string): AndSplitResult {

  if (hasCausalMarker(text)) return { action: "keep" };

  const andRe = /,?\s+and\s+/gi;
  let match: RegExpExecArray | null;
  const candidates: Array<{ index: number; length: number }> = [];

  while ((match = andRe.exec(text)) !== null) {
    candidates.push({ index: match.index, length: match[0].length });
  }

  if (candidates.length === 0) return { action: "keep" };

  for (let i = candidates.length - 1; i >= 0; i--) {
    const { index, length } = candidates[i];
    const left = text.slice(0, index).trim();
    const right = text.slice(index + length).trim();

    if (!left || !right) continue;

    const window = text.slice(Math.max(0, index - 30), Math.min(text.length, index + length + 30));
    if (COMPOUND_NOUN_BLOCKLIST_RE.test(window)) continue;

    if (/\bto\s+\w+$/i.test(left) && /^\w+\b/.test(right) && !looksLikeProposition(right)) continue;

    if (looksLikeProposition(left) && looksLikeProposition(right) && extractSubjectVerb(right)) {
      return { action: "split", parts: [left, right] };
    }

    if (looksLikeProposition(left) && !extractSubjectVerb(right)) {
      const sv = extractSubjectVerb(left);
      if (!sv) continue;

      const rightWithSubject = `${sv.subject} ${right}`;
      if (looksLikeProposition(rightWithSubject)) {
        return { action: "split", parts: [left, rightWithSubject] };
      }

      const rightWithSubjectVerb = `${sv.subject} ${sv.verb} ${right}`;
      if (looksLikeProposition(rightWithSubjectVerb)) {
        return { action: "split", parts: [left, rightWithSubjectVerb] };
      }
    }
  }

  return { action: "keep" };
}
