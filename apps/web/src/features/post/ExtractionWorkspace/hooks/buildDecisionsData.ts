import type {
  AtomAlternative,
  AtomMeta,
  DraftPost,
  MainRef,
  NestedProposalDraft,
  ProposalDraft,
} from "../extraction";

export function humanReadablePath(
  decisionPath: string | null | undefined,
  rationale: string | null | undefined,
): string {
  switch (decisionPath) {
    case "high_score":
      return "High confidence match";
    case "anti_dup":
      return "Exact canonical match";
    case "llm_review":
      return rationale ?? "AI-reviewed match";
    case "no_candidates":
      return "No existing match found";
    case "search_unavailable":
      return "Search unavailable";
    case "no_llm_fallback":
      return "Best available match";
    case "cache_hit":
      return "Same term used in other claims";
    default:
      return "Auto-selected";
  }
}

function fmtMetrics(meta: AtomMeta | null): string {
  if (!meta) return "";
  const parts: string[] = [];
  if (meta.selectedHolders != null) parts.push(`${meta.selectedHolders}p`);
  if (meta.selectedMarketCap != null) parts.push(`${meta.selectedMarketCap.toFixed(1)} MC`);
  if (meta.selectedSharePrice != null) parts.push(`${meta.selectedSharePrice.toFixed(2)}/sh`);
  return parts.length > 0 ? parts.join(" · ") : "";
}

function fmtAlt(a: AtomAlternative): string {
  const parts: string[] = [];
  if (a.holders != null) parts.push(`${a.holders}p`);
  if (a.marketCap != null) parts.push(`${a.marketCap.toFixed(1)} MC`);
  const metrics = parts.length > 0 ? `, ${parts.join(" · ")}` : "";
  return `${a.label} (${a.termId}${metrics})`;
}

type PositionConfig = {
  position: "SUBJECT" | "PREDICATE" | "OBJECT";
  rawLabel: string;
  matchedLabel: string | null;
  termId: string | null;
  confidence: number | null;
  meta: AtomMeta | null;
};

function formatPosition(cfg: PositionConfig): string {
  const label = cfg.matchedLabel || cfg.rawLabel;
  const isNew = !cfg.termId;
  const conf = cfg.confidence != null ? ` (${Math.round(cfg.confidence * 100)}%)` : "";
  const tag = isNew ? " [NEW]" : "";
  const reason = humanReadablePath(cfg.meta?.decisionPath, cfg.meta?.rationale);

  const lines: string[] = [];
  lines.push(`    ${cfg.position}: "${label}"${conf}${tag} — ${reason}`);

  if (!isNew) {
    const metrics = fmtMetrics(cfg.meta);
    if (metrics) lines.push(`      On-chain: ${metrics}`);
  }

  const alts = (cfg.meta?.alternatives ?? [])
    .filter((a) => a.termId !== cfg.termId)
    .slice(0, 2);
  if (alts.length > 0) {
    lines.push(`      Alternatives: ${alts.map(fmtAlt).join(", ")}`);
  }

  return lines.join("\n");
}

export function buildReasoningSummaryText(
  proposals: ProposalDraft[],
  draftPosts: DraftPost[],
  opts?: {
    mainRefByDraft?: Map<string, MainRef | null>;
    nestedProposals?: NestedProposalDraft[];
    nestedRefLabels?: Map<string, string>;
  },
): string {
  const proposalMap = new Map(proposals.map((p) => [p.id, p]));
  const multiPost = draftPosts.length > 1;

  const postBlocks: string[] = [];

  for (let i = 0; i < draftPosts.length; i++) {
    const draft = draftPosts[i];
    const draftProposals = draft.proposalIds
      .map((id) => proposalMap.get(id))
      .filter((p): p is ProposalDraft => p != null && p.status !== "rejected");

    if (draftProposals.length === 0) continue;

    const mainRef = opts?.mainRefByDraft?.get(draft.id) ?? null;
    const mainNestedSummary = mainRef?.type === "nested"
      ? opts?.nestedRefLabels?.get(mainRef.nestedStableKey)
        ?? opts?.nestedProposals?.find((n) => n.stableKey === mainRef.nestedStableKey)?.predicate
        ?? null
      : null;

    const claimLabel = mainNestedSummary ? "Leaf" : "Claim";
    const claimBlocks = draftProposals.map((p) => {
      const positions = [
        formatPosition({ position: "SUBJECT", rawLabel: p.sText, matchedLabel: p.subjectMatchedLabel, termId: p.subjectAtomId, confidence: p.subjectConfidence, meta: p.subjectMeta }),
        formatPosition({ position: "PREDICATE", rawLabel: p.pText, matchedLabel: p.predicateMatchedLabel, termId: p.predicateAtomId, confidence: p.predicateConfidence, meta: p.predicateMeta }),
        formatPosition({ position: "OBJECT", rawLabel: p.oText, matchedLabel: p.objectMatchedLabel, termId: p.objectAtomId, confidence: p.objectConfidence, meta: p.objectMeta }),
      ];
      return `  ${claimLabel}: ${p.sText} | ${p.pText} | ${p.oText}\n${positions.join("\n")}`;
    });

    const header = multiPost ? `Post ${i + 1}:\n` : "";
    const mainBlock = mainNestedSummary ? `  MAIN: ${mainNestedSummary}\n\n` : "";
    postBlocks.push(`${header}${mainBlock}${claimBlocks.join("\n\n")}`);
  }

  return postBlocks.join("\n\n");
}
