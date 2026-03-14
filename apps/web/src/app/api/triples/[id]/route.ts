import { NextResponse } from "next/server";
import { getTripleDetails } from "@0xintuition/sdk";
import { ensureIntuitionGraphql } from "@/lib/intuition";
import { parseVaultMetrics } from "@/lib/intuition/metrics";
import { mapTripleShape, resolveAtomLabel } from "@/lib/intuition/resolveTerm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TriplePageProps = {
  params: Promise<{ id: string }>;
};

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * GET /api/triples/[id]
 *
 * Returns the Subject-Predicate-Object data for a triple term ID
 * using the Intuition SDK. Resolves nested atoms (depth 1).
 */
export async function GET(request: Request, { params }: TriplePageProps) {
  const { id } = await params;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Triple ID is required." }, { status: 400 });
  }

  try {
    ensureIntuitionGraphql();
    const details = await getTripleDetails(id);

    if (!details) {
      return NextResponse.json({ error: "Triple not found." }, { status: 404 });
    }

    const base = mapTripleShape(details);

    // Resolve nested atoms in parallel (subject + object only, predicate is never nested)
    const [subjectResolved, objectResolved] = await Promise.all([
      resolveAtomLabel(details.subject, details.subject_id ? String(details.subject_id) : null),
      resolveAtomLabel(details.object, details.object_id ? String(details.object_id) : null),
    ]);

    return NextResponse.json({
      triple: {
        id: base.termId || id,
        subject: subjectResolved.label,
        predicate: base.predicate,
        object: objectResolved.label,
        creator: details.creator?.label ?? details.creator_id ?? "Unknown",
        createdAt: details.created_at ?? null,
        marketCap: base.marketCap,
        holders: base.holders,
        shares: base.shares,
        sharePrice: parseVaultMetrics(details.term?.vaults?.[0]).sharePrice,
        counterTermId: base.counterTermId,
        subjectNested: subjectResolved.nestedTriple,
        objectNested: objectResolved.nestedTriple,
      },
    });
  } catch (error: unknown) {
    console.error("Failed to fetch triple details:", error);
    return NextResponse.json(
      { error: "Failed to fetch triple data from Intuition." },
      { status: 502 },
    );
  }
}
