import { NextResponse } from "next/server";
import { runExtraction, type RejectionCode } from "@db/agents";
import { createPublicClient, http, type Address } from "viem";
import { getMultiVaultAddressFromChainId } from "@0xintuition/sdk";

import { prisma } from "@/server/db/prisma";
import { normalizeLabelForChain } from "@/lib/format/normalizeLabel";
import { makeLabelKey } from "@/lib/format/makeLabelKey";
import { normalizeAtomLabel } from "@/features/post/ExtractionWorkspace/publish/config";
import { validateSubmissionRequest } from "@/server/api/validateSubmission";
import { searchAtomsServer, type ExactLookupConfig } from "@/lib/intuition/search";
import { intuitionTestnet } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ── Exact on-chain atom lookup config (read-only, no wallet needed) ── */

const extractPublicClient = createPublicClient({
  chain: intuitionTestnet,
  transport: http(),
});

const exactLookupConfig: ExactLookupConfig = {
  publicClient: extractPublicClient,
  multivaultAddress: getMultiVaultAddressFromChainId(intuitionTestnet.id) as Address,
  normalizeLabel: normalizeAtomLabel,
};

type AgentAtomMeta = {
  rationale?: string | null;
  decisionPath?: string | null;
  alternatives?: Array<{ termId: string; label: string; marketCap: number | null; holders: number | null; shares: number | null; sharePrice: number | null }>;
  selectedHolders?: number | null;
  selectedShares?: number | null;
  selectedMarketCap?: number | null;
  selectedSharePrice?: number | null;
};

type AgentTriple = {
  subject: string;
  predicate: string;
  object: string;
  stableKey?: string;
  subjectTermId?: string | null;
  predicateTermId?: string | null;
  objectTermId?: string | null;
  subjectConfidence?: number;
  predicateConfidence?: number;
  objectConfidence?: number;
  subjectMatchedLabel?: string | null;
  predicateMatchedLabel?: string | null;
  objectMatchedLabel?: string | null;
  subjectMeta?: AgentAtomMeta;
  predicateMeta?: AgentAtomMeta;
  objectMeta?: AgentAtomMeta;
};

type AgentClaim = {
  claim: string;
  triple: AgentTriple | null;
  role: "MAIN" | "SUPPORTING";
  group?: number;
  outermostMainKey?: string | null;
  suggestedStance?: "SUPPORTS" | "REFUTES";
  stanceAligned?: boolean;
  stanceReason?: string;
  isRelevant?: boolean;
};

type AgentSegment = {
  claims: AgentClaim[];
  sentence: string;
};

type AgentTermRef =
  | { type: "atom"; atomKey: string; label: string }
  | { type: "triple"; tripleKey: string };

type AgentNestedEdge = {
  kind: string;
  origin: string;
  predicate: string;
  subject: AgentTermRef;
  object: AgentTermRef;
  stableKey: string;
};

type AgentDerivedTriple = {
  subject: string;
  predicate: string;
  object: string;
  stableKey: string;
  ownerGroupKey: string;
};

type AgentExtractionResult = {
  perSegment: AgentSegment[];
  nested: AgentNestedEdge[];
  derivedTriples: AgentDerivedTriple[];
};

type ProposalSeed = {
  sText: string;
  pText: string;
  oText: string;
  key: string;
  stableKey: string | null;
  role: "MAIN" | "SUPPORTING";
  groupKey: string;
  suggestedStance?: "SUPPORTS" | "REFUTES";
  stanceAligned?: boolean;
  stanceReason?: string;
  isRelevant?: boolean;
  claimText: string;
  segmentIndex: number;
  sentenceText: string;
  subjectTermId?: string | null;
  predicateTermId?: string | null;
  objectTermId?: string | null;
  subjectConfidence?: number;
  predicateConfidence?: number;
  objectConfidence?: number;
  subjectMatchedLabel?: string | null;
  predicateMatchedLabel?: string | null;
  objectMatchedLabel?: string | null;
  subjectMeta?: AgentAtomMeta | null;
  predicateMeta?: AgentAtomMeta | null;
  objectMeta?: AgentAtomMeta | null;
  outermostMainKey: string | null;
};

type NestedProposalSeed = {
  edgeKind: string;
  predicate: string;
  subject: AgentTermRef;
  object: AgentTermRef;
  stableKey: string;
};

type ErrorInfo = {
  message: string;
  name?: string;
  stack?: string | null;
};

const normalizeText = normalizeLabelForChain;


function makeProposalDedupKey(
  claim: AgentClaim,
  sText: string,
  pText: string,
  oText: string,
): string {
  const outerKey = claim.outermostMainKey?.trim();
  if (outerKey) return `mainref:${outerKey}`;
  return `core:${makeLabelKey(sText, pText, oText)}`;
}

function collectCandidates(result: AgentExtractionResult): { seeds: ProposalSeed[]; droppedCounts: { noTriple: number; emptySpo: number } } {
  const seen = new Map<string, ProposalSeed>();
  const out: ProposalSeed[] = [];
  const droppedCounts = { noTriple: 0, emptySpo: 0 };

  for (let segIdx = 0; segIdx < result.perSegment.length; segIdx++) {
    const segment = result.perSegment[segIdx];
    for (const claim of segment.claims) {
      const triple = claim.triple;
      if (!triple) {
        droppedCounts.noTriple++;
        console.warn("[extract-skip]", { reason: "noTriple", claimText: claim.claim });
        continue;
      }

      const sText = normalizeText(triple.subject);
      const pText = normalizeText(triple.predicate);
      const oText = normalizeText(triple.object);
      if (!sText || !pText || !oText) {
        droppedCounts.emptySpo++;
        console.warn("[extract-skip]", { reason: "emptySpo", claimText: claim.claim, sText, pText, oText });
        continue;
      }

      const key = makeProposalDedupKey(claim, sText, pText, oText);

      if (seen.has(key)) {
        const existing = seen.get(key)!;
        if (claim.stanceAligned === false) {
          if (existing.stanceAligned !== false) {
            existing.suggestedStance = claim.suggestedStance;
            existing.stanceAligned = false;
            existing.stanceReason = claim.stanceReason;
          } else {
            if (!existing.stanceReason && claim.stanceReason) {
              existing.stanceReason = claim.stanceReason;
            }
            if (!existing.suggestedStance && claim.suggestedStance) {
              existing.suggestedStance = claim.suggestedStance;
            }
          }
        }
        continue;
      }

      const seed: ProposalSeed = {
        sText, pText, oText, key,
        stableKey: triple.stableKey ?? null,
        role: claim.role ?? "SUPPORTING",
        claimText: claim.claim,
        groupKey: `${segIdx}:${claim.group ?? 0}`,
        suggestedStance: claim.suggestedStance,
        stanceAligned: claim.stanceAligned,
        stanceReason: claim.stanceReason,
        isRelevant: claim.isRelevant,
        segmentIndex: segIdx,
        sentenceText: segment.sentence ?? "",
        subjectTermId: triple.subjectTermId ?? null,
        predicateTermId: triple.predicateTermId ?? null,
        objectTermId: triple.objectTermId ?? null,
        subjectConfidence: triple.subjectConfidence,
        predicateConfidence: triple.predicateConfidence,
        objectConfidence: triple.objectConfidence,
        subjectMatchedLabel: triple.subjectMatchedLabel ?? null,
        predicateMatchedLabel: triple.predicateMatchedLabel ?? null,
        objectMatchedLabel: triple.objectMatchedLabel ?? null,
        subjectMeta: triple.subjectMeta ?? null,
        predicateMeta: triple.predicateMeta ?? null,
        objectMeta: triple.objectMeta ?? null,
        outermostMainKey: claim.outermostMainKey ?? null,
      };
      seen.set(key, seed);
      out.push(seed);
    }
  }

  return { seeds: out, droppedCounts };
}

function collectNestedProposals(nested: AgentNestedEdge[]): NestedProposalSeed[] {
  const seen = new Set<string>();
  const out: NestedProposalSeed[] = [];

  for (const edge of nested) {
    if (seen.has(edge.stableKey)) continue;
    seen.add(edge.stableKey);

    out.push({
      edgeKind: edge.kind,
      predicate: edge.predicate,
      subject: edge.subject,
      object: edge.object,
      stableKey: edge.stableKey,
    });
  }

  return out;
}

function toSafeError(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    message: typeof error === "string" ? error : "Unknown error",
    stack: null,
  };
}

export async function POST(request: Request) {
  const result = await validateSubmissionRequest(request, { includeParentBody: true });
  if (!result.ok) return result.response;

  const {
    userId, themeSlug, trimmedInput,
    normalizedParentPostId, normalizedStance,
    theme, parentBody: parentClaimText,
  } = result.data;

  const submission = await prisma.submission.create({
    data: {
      userId,
      themeSlug,
      parentPostId: normalizedParentPostId,
      stance: normalizedStance,
      inputText: trimmedInput,
      status: "EXTRACTING",
    },
  });

  const themeName = theme.name;

  try {
    const extraction = await runExtraction(trimmedInput, {
      themeTitle: themeName,
      parentClaimText,
      userStance: normalizedStance,
      searchFn: (query, limit) => searchAtomsServer(query, limit, exactLookupConfig),
    });
    const { seeds: candidates, droppedCounts } = collectCandidates(extraction);
    const nestedSeeds = collectNestedProposals(extraction.nested ?? []);
    if (droppedCounts.noTriple > 0 || droppedCounts.emptySpo > 0) {
      console.warn("[extract] droppedCounts:", droppedCounts);
    }

    if (extraction.rejection) {
      await prisma.submission.update({
        where: { id: submission.id },
        data: { status: "FAILED" },
      });
      const statusMap: Record<RejectionCode, number> = {
        OFF_TOPIC: 422,
        NOT_DEBATABLE: 422,
        GIBBERISH: 422,
        NO_MAIN_CLAIMS: 422,
        NO_NEW_INFORMATION: 422,
        LLM_UNAVAILABLE: 503,
      };
      return NextResponse.json(
        { error: extraction.rejection.code, rejection: true },
        { status: statusMap[extraction.rejection.code] ?? 422 },
      );
    }

    if (candidates.length === 0) {
      await prisma.submission.update({
        where: { id: submission.id },
        data: { status: "FAILED" },
      });
      return NextResponse.json(
        { error: "NO_MAIN_CLAIMS", rejection: true },
        { status: 422 },
      );
    }

    await prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: "READY_TO_PUBLISH",
      },
    });

    return NextResponse.json({
      submission: {
        id: submission.id,
        status: "READY_TO_PUBLISH",
        createdAt: submission.createdAt.toISOString(),
        userId: submission.userId,
        themeSlug: submission.themeSlug,
        parentPostId: submission.parentPostId,
        stance: submission.stance,
      },
      proposals: candidates.map((candidate, index) => ({
        id: `proposal_${submission.id}_${index}`,
        kind: "TRIPLE" as const,
        payload: {
          subject: candidate.sText,
          predicate: candidate.pText,
          object: candidate.oText,
          stableKey: candidate.stableKey,
          role: candidate.role,
          suggestedStance: candidate.suggestedStance ?? null,
          stanceAligned: candidate.stanceAligned ?? null,
          stanceReason: candidate.stanceReason ?? null,
          isRelevant: candidate.isRelevant ?? null,
          claimText: candidate.claimText,
          sentenceText: candidate.sentenceText,
          segmentIndex: candidate.segmentIndex,
          groupKey: candidate.groupKey,
          subjectTermId: candidate.subjectTermId ?? null,
          predicateTermId: candidate.predicateTermId ?? null,
          objectTermId: candidate.objectTermId ?? null,
          subjectConfidence: candidate.subjectConfidence ?? null,
          predicateConfidence: candidate.predicateConfidence ?? null,
          objectConfidence: candidate.objectConfidence ?? null,
          subjectMatchedLabel: candidate.subjectMatchedLabel ?? null,
          predicateMatchedLabel: candidate.predicateMatchedLabel ?? null,
          objectMatchedLabel: candidate.objectMatchedLabel ?? null,
          subjectMeta: candidate.subjectMeta ?? null,
          predicateMeta: candidate.predicateMeta ?? null,
          objectMeta: candidate.objectMeta ?? null,
          outermostMainKey: candidate.outermostMainKey,
        },
        decision: "PENDING" as const,
      })),
      nestedProposals: nestedSeeds.map((seed, index) => ({
        id: `nested_${submission.id}_${index}`,
        kind: "NESTED_TRIPLE" as const,
        payload: {
          edgeKind: seed.edgeKind,
          predicate: seed.predicate,
          subject: seed.subject,
          object: seed.object,
          stableKey: seed.stableKey,
        },
        decision: "PENDING" as const,
      })),
      derivedTriples: (extraction.derivedTriples ?? []).map((dt) => ({
        subject: dt.subject,
        predicate: dt.predicate,
        object: dt.object,
        stableKey: dt.stableKey,
        ownerGroupKey: dt.ownerGroupKey,
      })),
      droppedCounts,
    });
  } catch (error) {
    const safeError = toSafeError(error);
    console.error("[POST /api/extract] extraction failed:", safeError);

    await prisma.submission.update({
      where: { id: submission.id },
      data: { status: "FAILED" },
    });

    return NextResponse.json(
      { error: "EXTRACTION_FAILED", rejection: true, details: safeError.message },
      { status: 500 },
    );
  }
}
