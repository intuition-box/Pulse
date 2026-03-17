import type { ClaimNode, ClaimTreePlan, ClaimTreeLeaf, DecomposedClaim } from "../types.js";
import { parseMetaClaim, parseConditional, parseCausal } from "./parse.js";
import type { GraphResult } from "./claimPlanner.js";
import { PROBABLE_VERB_RE } from "./rules/extractionRules.js";

const MAX_DEPTH = 6;
const MIN_PROPOSITION_WORDS = 3;
const ANAPHORIC_LEAF_START_RE = /^(?:it|this|that|these|those|they|he|she|we|there)\b/i;

const ACCORDING_TO_RE = /^According\s+to\s+(.+?),\s+(.+)$/i;

type MetaMatch = { source: string; verb: string; proposition: string };
type CondMatch = { kw: string; condText: string; mainText: string; compoundKw?: string };
type CausalMatch = { marker: "because" | "since"; mainText: string; reasonText: string };

type ParseCandidate =
  | { type: "meta"; match: MetaMatch; markerPos: number }
  | { type: "conditional"; match: CondMatch; markerPos: number }
  | { type: "causal"; match: CausalMatch; markerPos: number };

function tryNormalizeMeta(text: string): MetaMatch | null {
  const std = parseMetaClaim(text);
  if (std) return std;

  const m = text.match(ACCORDING_TO_RE);
  if (m) {
    const source = m[1].trim();
    const proposition = m[2].trim();
    if (source && proposition) return { source, verb: "according to", proposition };
  }
  return null;
}

const ESPECIALLY_COND_RE = /,?\s*(?:especially|particularly|notably)\s+(if|when|unless)\s+/i;

function tryNormalizeConditional(text: string): CondMatch | null {
  // Try ESPECIALLY normalization before parseConditional to avoid "particularly" leaking into mainText
  const m = ESPECIALLY_COND_RE.exec(text);
  if (m) {
    const mainText = text.slice(0, m.index).trim().replace(/[,;:]$/, "").trim();
    const condText = text.slice(m.index + m[0].length).trim().replace(/\.$/, "").trim();
    const kw = m[1].toLowerCase();
    if (mainText && condText) {
      return { kw, mainText, condText };
    }
  }

  const result = parseConditional(text);
  if (result?.compoundKw) return null; // keep compound predicates ("only when", "even if") intact
  return result;
}

function tryNormalizeCausal(text: string): CausalMatch | null {
  return parseCausal(text);
}

function findMarkerPos(text: string, type: "meta" | "conditional" | "causal", match: MetaMatch | CondMatch | CausalMatch): number {
  const lower = text.toLowerCase();
  switch (type) {
    case "meta": {
      const m = match as MetaMatch;
      const accIdx = lower.indexOf("according to");
      if (accIdx !== -1) return accIdx;
      return lower.indexOf(m.verb.toLowerCase());
    }
    case "conditional": {
      const c = match as CondMatch;
      const kw = c.compoundKw ?? c.kw;
      return lower.indexOf(kw.toLowerCase());
    }
    case "causal": {
      const ca = match as CausalMatch;
      return lower.indexOf(ca.marker);
    }
  }
}

function gatherCandidates(text: string): ParseCandidate[] {
  const candidates: ParseCandidate[] = [];

  const meta = tryNormalizeMeta(text);
  if (meta) {
    candidates.push({ type: "meta", match: meta, markerPos: findMarkerPos(text, "meta", meta) });
  }

  const cond = tryNormalizeConditional(text);
  if (cond) {
    candidates.push({ type: "conditional", match: cond, markerPos: findMarkerPos(text, "conditional", cond) });
  }

  const causal = tryNormalizeCausal(text);
  if (causal) {
    candidates.push({ type: "causal", match: causal, markerPos: findMarkerPos(text, "causal", causal) });
  }

  return candidates;
}

function rankCandidates(text: string): ParseCandidate[] {
  const candidates = gatherCandidates(text);
  if (candidates.length <= 1) return candidates;

  const meta = candidates.filter((c) => c.type === "meta");
  const structural = candidates.filter((c) => c.type !== "meta");
  structural.sort((a, b) => a.markerPos - b.markerPos);

  // Sentence-initial meta ("According to X, ..." at position 0) is the outermost
  // wrapper — try it first so the inner proposition stays intact for LLM extraction.
  // Non-initial meta ("Scientists argue that X if Y") lets structural win.
  if (meta.length > 0 && meta[0].markerPos === 0) {
    return [...meta, ...structural];
  }

  return [...structural, ...meta];
}

function hasVerb(text: string): boolean {
  return PROBABLE_VERB_RE.test(text);
}

function isImmediateClause(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < MIN_PROPOSITION_WORDS && !hasVerb(text)) return true;
  return false;
}

function isShortProposition(text: string): boolean {
  return text.split(/\s+/).filter(Boolean).length < MIN_PROPOSITION_WORDS;
}

function hasShortLeaf(node: ClaimNode): boolean {
  switch (node.kind) {
    case "proposition":
      return isShortProposition(node.text);
    case "clause":
      return false;
    case "meta":
      return hasShortLeaf(node.child);
    case "conditional":
      return hasShortLeaf(node.main) && hasShortLeaf(node.condition);
    case "causal":
      return hasShortLeaf(node.main) && hasShortLeaf(node.reason);
  }
}

function buildNodeFromCandidate(
  candidate: ParseCandidate,
  role: "MAIN" | "SUPPORTING",
  group: number,
  depth: number,
): ClaimNode {
  switch (candidate.type) {
    case "meta": {
      const { source, verb, proposition } = candidate.match;
      const child = buildTreeRec(proposition, role, group, depth + 1);
      return { kind: "meta", source, verb, child };
    }
    case "conditional": {
      const { kw, mainText, condText, compoundKw } = candidate.match;
      const main = buildTreeRec(mainText, role, group, depth + 1);
      const condition = buildTreeRec(condText, "SUPPORTING", group, depth + 1);
      const node: ClaimNode = { kind: "conditional", main, condition, kw };
      if (compoundKw) (node as Extract<ClaimNode, { kind: "conditional" }>).compoundKw = compoundKw;
      return node;
    }
    case "causal": {
      const { marker, mainText, reasonText } = candidate.match;
      const main = buildTreeRec(mainText, role, group, depth + 1);
      const reason = buildTreeRec(reasonText, "SUPPORTING", group, depth + 1);
      return { kind: "causal", main, reason, marker };
    }
  }
}

function buildTreeRec(
  text: string,
  role: "MAIN" | "SUPPORTING",
  group: number,
  depth: number,
): ClaimNode {
  const trimmed = text.trim().replace(/\.$/, "").trim();

  if (depth >= MAX_DEPTH) {
    if (isImmediateClause(trimmed)) return { kind: "clause", text: trimmed };
    return { kind: "proposition", text: trimmed, role, group };
  }

  if (isImmediateClause(trimmed)) {
    return { kind: "clause", text: trimmed };
  }

  const candidates = rankCandidates(trimmed);
  for (const candidate of candidates) {
    const node = buildNodeFromCandidate(candidate, role, group, depth);
    if (!hasShortLeaf(node)) return node;
  }

  return { kind: "proposition", text: trimmed, role, group };
}

export function buildClaimTree(
  text: string,
  role: "MAIN" | "SUPPORTING",
  group: number,
): ClaimNode {
  return buildTreeRec(text, role, group, 0);
}

function collectLeavesRec(node: ClaimNode, leaves: ClaimTreeLeaf[], path: string): void {
  switch (node.kind) {
    case "proposition":
      leaves.push({ leafId: `leaf:${path}:${node.text}`, text: node.text });
      break;
    case "clause":
      break;
    case "meta":
      collectLeavesRec(node.child, leaves, `${path}/meta-child`);
      break;
    case "conditional":
      collectLeavesRec(node.main, leaves, `${path}/cond-main`);
      collectLeavesRec(node.condition, leaves, `${path}/cond-sub`);
      break;
    case "causal":
      collectLeavesRec(node.main, leaves, `${path}/causal-main`);
      collectLeavesRec(node.reason, leaves, `${path}/causal-reason`);
      break;
  }
}

export function collectLeaves(node: ClaimNode): ClaimTreeLeaf[] {
  const leaves: ClaimTreeLeaf[] = [];
  collectLeavesRec(node, leaves, "root");
  return leaves;
}

export function nodeText(node: ClaimNode): string {
  switch (node.kind) {
    case "proposition":
    case "clause":
      return node.text;
    case "meta":
      return `${node.source} ${node.verb} ${nodeText(node.child)}`;
    case "conditional":
      return `${nodeText(node.main)} ${node.kw} ${nodeText(node.condition)}`;
    case "causal":
      return `${nodeText(node.main)} ${node.marker} ${nodeText(node.reason)}`;
  }
}

export function buildClaimTreePlans(
  claims: DecomposedClaim[],
  sentenceContext: string,
  graphFromClaim: (claimText: string, sentenceContext: string) => Promise<GraphResult | null>,
): { plans: ClaimTreePlan[]; graphJobs: Map<string, Promise<GraphResult | null>> } {
  const plans: ClaimTreePlan[] = [];
  const graphJobs = new Map<string, Promise<GraphResult | null>>();

  for (const dc of claims) {
    const tree = buildClaimTree(dc.text, dc.role, dc.group);
    const leaves = collectLeaves(tree);
    const graphKeys: string[] = [];

    for (const leaf of leaves) {
      if (!graphJobs.has(leaf.leafId)) {
        const leafContext = ANAPHORIC_LEAF_START_RE.test(leaf.text.trim())
          ? [sentenceContext, dc.text].filter(Boolean).join(" ").trim()
          : "";
        graphJobs.set(leaf.leafId, graphFromClaim(leaf.text + ".", leafContext));
      }
      graphKeys.push(leaf.leafId);
    }

    plans.push({
      tree,
      claim: dc.text,
      role: dc.role,
      group: dc.group,
      leaves,
      graphKeys,
    });
  }

  return { plans, graphJobs };
}
