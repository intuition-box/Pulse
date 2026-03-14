

import type { FlatTriple } from "../types.js";
import { IDENTITY_VERBS_RE } from "./rules/extractionRules.js";

export function normalizeWord(w: string): string {
  let n = w.toLowerCase().replace(/[.,;:!?'"()]+$/, "");

  if (n.endsWith("ing") && n.length > 5) n = n.slice(0, -3);
  if (n.endsWith("ed") && n.length > 4) n = n.slice(0, -2);
  if (n.endsWith("s") && !n.endsWith("ss") && n.length > 3) n = n.slice(0, -1);
  return n;
}

export function checkReflexive(
  core: FlatTriple,
): { valid: boolean; reason?: string } {
  if (!IDENTITY_VERBS_RE.test(core.predicate.trim())) return { valid: true };
  const normS = normalizeWord(core.subject.trim());
  const normO = normalizeWord(core.object.trim());
  if (normS === normO) {
    return { valid: false, reason: "reflexive triple (subject ≈ object with identity verb)" };
  }
  return { valid: true };
}
