import type { MatchedTree } from "../extraction";

const ARTICLES = /^(the|a|an)\s+/i;

const stemPlural = (w: string): string =>
  w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;

export function normalizeLeaf(label: string): string {
  return label.toLowerCase().replace(ARTICLES, "").trim()
    .split(/\s+/).map(stemPlural).join(" ");
}

// Collect all leaf atom labels from a tree (atoms, not intermediate triples)
export function collectLeaves(tree: MatchedTree): string[] {
  const leaves: string[] = [];

  if (tree.subjectNested) {
    leaves.push(...collectLeaves(tree.subjectNested));
  } else {
    leaves.push(tree.subject);
  }

  leaves.push(tree.predicate);

  if (tree.objectNested) {
    leaves.push(...collectLeaves(tree.objectNested));
  } else {
    leaves.push(tree.object);
  }

  return leaves;
}

// Compare two trees by their leaf atoms, ignoring nesting structure.

export function treeLeavesMatch(onChain: MatchedTree, extracted: MatchedTree): boolean {
  const onChainLeaves = collectLeaves(onChain).map(normalizeLeaf);
  const extractedLeaves = collectLeaves(extracted).map(normalizeLeaf);
  return onChainLeaves.join(" ") === extractedLeaves.join(" ");
}

// Depth of a MatchedTree (1 = flat, 2+ = nested).
export function treeDepth(tree: MatchedTree): number {
  return 1 + Math.max(
    tree.subjectNested ? treeDepth(tree.subjectNested) : 0,
    tree.objectNested ? treeDepth(tree.objectNested) : 0,
  );
}

// Collect all predicates from a tree (recursively).
function collectPredicates(tree: MatchedTree): string[] {
  const preds = [normalizeLeaf(tree.predicate)];
  if (tree.subjectNested) preds.push(...collectPredicates(tree.subjectNested));
  if (tree.objectNested) preds.push(...collectPredicates(tree.objectNested));
  return preds;
}

// Get the deepest subject leaf label (recurse into subjectNested).
function getDeepestSubject(tree: MatchedTree): string {
  return tree.subjectNested ? getDeepestSubject(tree.subjectNested) : tree.subject;
}

// Build a restructured tree where `onChainTree` becomes a nested sub-tree

function buildRestructured(
  onChainTree: MatchedTree,
  extractedTree: MatchedTree,
  remainingLeaves: string[],
): MatchedTree | null {
  if (remainingLeaves.length !== 2) return null;

  // Determine direction: does on-chain contain the extracted tree's root subject?
  const extractedSubjectLeaf = normalizeLeaf(getDeepestSubject(extractedTree));
  const onChainNormalized = collectLeaves(onChainTree).map(normalizeLeaf);
  const onChainIsSubject = onChainNormalized.includes(extractedSubjectLeaf);

  const extractedPredicates = new Set(collectPredicates(extractedTree));
  let predLeaf: string | null = null;
  let atomLeaf: string | null = null;

  for (const leaf of remainingLeaves) {
    if (predLeaf === null && extractedPredicates.has(leaf)) {
      predLeaf = leaf;
    } else {
      atomLeaf = leaf;
    }
  }

  if (predLeaf === null || atomLeaf === null) {
    return null;
  }

  const allExtractedLeaves = collectLeaves(extractedTree);
  const originalPred = allExtractedLeaves.find((l) => normalizeLeaf(l) === predLeaf) ?? predLeaf;
  const originalAtom = allExtractedLeaves.find((l) => normalizeLeaf(l) === atomLeaf) ?? atomLeaf;

  if (onChainIsSubject) {
    return {
      subject: onChainTree.subject,
      predicate: originalPred,
      object: originalAtom,
      subjectNested: onChainTree,
    };
  } else {
    return {
      subject: originalAtom,
      predicate: originalPred,
      object: onChainTree.object,
      objectNested: onChainTree,
    };
  }
}

// Find an on-chain tree whose leaves are a strict subset of the extracted tree's leaves.
//  * Returns the matching on-chain tree + a restructured tree with the on-chain as inner.

export function findSubTreeMatch(
  onChainTrees: Array<{ termId: string; tree: MatchedTree }>,
  extractedTree: MatchedTree,
): { termId: string; tree: MatchedTree; restructured: MatchedTree } | null {
  const extractedNormalized = collectLeaves(extractedTree).map(normalizeLeaf);

  for (const candidate of onChainTrees) {
    const candidateNormalized = collectLeaves(candidate.tree).map(normalizeLeaf);

    if (candidateNormalized.length >= extractedNormalized.length) continue;

    const extractedBag = [...extractedNormalized];
    let allFound = true;
    for (const leaf of candidateNormalized) {
      const idx = extractedBag.indexOf(leaf);
      if (idx === -1) {
        allFound = false;
        break;
      }
      extractedBag.splice(idx, 1);
    }
    if (!allFound) continue;

    const restructured = buildRestructured(candidate.tree, extractedTree, extractedBag);
    if (restructured) {
      return { termId: candidate.termId, tree: candidate.tree, restructured };
    }
  }

  return null;
}
