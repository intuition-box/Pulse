import { NextResponse } from "next/server";

import type { Stance } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { requireSiweAuth } from "@/server/auth/siwe";
import { getErrorMessage } from "@/lib/getErrorMessage";
import { validateSemanticGuard } from "@/app/api/chat/refine/validate";
import { isValidDraftPost, type DraftPostPayload } from "./validation";
import { isStanceId } from "@/features/post/ExtractionWorkspace/extraction/idPrefixes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreatedPostRecord = {
  post: { id: string; publishedAt: Date | null };
  tripleLinks: Array<{ id: string; termId: string; role: "MAIN" | "SUPPORTING" }>;
};

export async function POST(request: Request) {
  try {
    let auth: { userId: string };
    try {
      auth = await requireSiweAuth(request);
    } catch (error: unknown) {
      return NextResponse.json(
        { error: getErrorMessage(error, "Unauthorized.") },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const {
      submissionId,
      idempotencyKey,
      posts: rawPosts,
      tripleTxHash,
      nestedTxHash,
      stanceTxHash,
    } = body as {
      submissionId?: string;
      idempotencyKey?: string;
      posts?: unknown[];
      tripleTxHash?: string | null;
      nestedTxHash?: string | null;
      stanceTxHash?: string | null;
    };

    if (!submissionId || typeof submissionId !== "string") {
      return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
    }

    if (!idempotencyKey || typeof idempotencyKey !== "string") {
      return NextResponse.json({ error: "idempotencyKey is required." }, { status: 400 });
    }

    // ─── Fetch submission ─────────────────────────────────────────────────

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
    });

    if (!submission) {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }

    if (submission.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // ─── Idempotency checks (BEFORE payload validation) ───────────────────
    // A retry with a malformed payload should still return the published result.

    if (submission.status === "PUBLISHED") {
      const existingPosts = await prisma.post.findMany({
        where: { originSubmissionId: submission.id },
        include: { tripleLinks: true },
        orderBy: { createdAt: "asc" },
      });
      if (existingPosts.length > 0) {
        const seenTermIds = new Set<string>();
        const txPlan = existingPosts.flatMap((p) =>
          p.tripleLinks
            .filter((link) => {
              if (seenTermIds.has(link.termId)) return false;
              seenTermIds.add(link.termId);
              return true;
            })
            .map((link) => ({
              id: link.termId,
              kind: "triple" as const,
              intuitionId: link.termId,
              status: "published" as const,
              txHash: null,
              error: null,
            })),
        );
        return NextResponse.json({
          posts: existingPosts.map((p) => ({
            id: p.id,
            publishedAt: p.publishedAt?.toISOString(),
          })),
          txPlan,
        });
      }
      return NextResponse.json(
        { error: "Submission already published." },
        { status: 409 },
      );
    }

    if (submission.status !== "PUBLISHING") {
      return NextResponse.json(
        { error: "Submission is not in PUBLISHING state. Call /api/publish/prepare first." },
        { status: 409 },
      );
    }

    if (submission.publishIdempotencyKey !== idempotencyKey) {
      return NextResponse.json(
        {
          error: "Another publication is already in progress.",
          details: {
            expected: submission.publishIdempotencyKey,
            received: idempotencyKey,
          },
        },
        { status: 409 },
      );
    }

    // ─── Validate posts[] (AFTER idempotency + submission loaded) ───

    if (!Array.isArray(rawPosts) || rawPosts.length === 0) {
      return NextResponse.json({ error: "posts array must not be empty." }, { status: 400 });
    }
    if (!rawPosts.every(isValidDraftPost)) {
      return NextResponse.json({ error: "Invalid draft post format in payload." }, { status: 400 });
    }
    const validPosts = rawPosts as DraftPostPayload[];

    // ─── Per-post validation: exactly 1 MAIN across triples + nestedTriples ──

    for (const post of validPosts) {
      const mainCount =
        post.triples.filter((t) => t.role === "MAIN").length +
        (post.nestedTriples ?? []).filter((t) => t.role === "MAIN").length;
      if (mainCount !== 1) {
        return NextResponse.json(
          { error: `Each post must have exactly 1 MAIN triple (draft "${post.draftId}" has ${mainCount}).` },
          { status: 400 },
        );
      }
    }

    // ─── Semantic guard (blocking) ─────────────────────────────────────────

    for (const draftPost of validPosts) {
      const referenceText = draftPost.body || submission.inputText;
      for (const triple of draftPost.triples) {
        if (triple.isExisting) continue;
        if (!triple.sLabel || !triple.pLabel || !triple.oLabel) continue;
        const guardResult = validateSemanticGuard(referenceText, {
          subject: triple.sLabel,
          predicate: triple.pLabel,
          object: triple.oLabel,
        });
        if (!guardResult.allowed) {
          console.warn(JSON.stringify({
            event: "publish_guard_blocked",
            submissionId,
            draftId: draftPost.draftId,
            tripleTermId: triple.tripleTermId,
            reason: guardResult.reason,
            timestamp: new Date().toISOString(),
          }));
          return NextResponse.json(
            { error: guardResult.reason ?? "A claim does not match the post text." },
            { status: 400 },
          );
        }
      }
    }

    // ─── DB Transaction: create N Posts ────────────────────────────────────

    const result = await prisma.$transaction(async (tx) => {
      const createdPosts: CreatedPostRecord[] = [];

      for (const draftPost of validPosts) {
        const post = await tx.post.create({
          data: {
            themeSlug: submission.themeSlug,
            userId: submission.userId,
            body: draftPost.body,
            publishedAt: new Date(),
            parentPostId: submission.parentPostId ?? undefined,
            stance: (draftPost.stance as Stance) ?? submission.stance ?? undefined,
            originSubmissionId: submission.id,
          },
        });

        const seenTermIds = new Set<string>();
        const postTripleLinks: CreatedPostRecord["tripleLinks"] = [];

        for (const triple of draftPost.triples) {
          if (seenTermIds.has(triple.tripleTermId)) continue;
          // Skip auto-generated stance triples — stance is stored in Post.stance,
          // triple is already published on-chain via stanceTxHash
          if (isStanceId(triple.proposalId)) continue;
          seenTermIds.add(triple.tripleTermId);
          const link = await tx.postTripleLink.create({
            data: { postId: post.id, termId: triple.tripleTermId, role: triple.role },
          });
          postTripleLinks.push(link);
        }

        for (const nested of (draftPost.nestedTriples ?? [])) {
          if (seenTermIds.has(nested.tripleTermId)) continue;
          seenTermIds.add(nested.tripleTermId);
          const link = await tx.postTripleLink.create({
            data: { postId: post.id, termId: nested.tripleTermId, role: nested.role ?? "SUPPORTING" },
          });
          postTripleLinks.push(link);
        }

        createdPosts.push({ post, tripleLinks: postTripleLinks });
      }

      // publishedPostId = first post (anchor)
      await tx.submission.update({
        where: { id: submission.id },
        data: {
          status: "PUBLISHED",
          publishedPostId: createdPosts[0].post.id,
        },
      });

      return createdPosts;
    });

    // ─── Build txPlan (global, deduplicated) ──────────────────────────────

    const txPlan: Array<{
      id: string;
      kind: "triple";
      intuitionId: string;
      status: "published";
      txHash: string | null;
      error: null;
    }> = [];
    const seenTxPlanIds = new Set<string>();

    for (const draftPost of validPosts) {
      for (const triple of draftPost.triples) {
        if (seenTxPlanIds.has(triple.tripleTermId)) continue;
        seenTxPlanIds.add(triple.tripleTermId);
        const isStance = isStanceId(triple.proposalId);
        txPlan.push({
          id: triple.tripleTermId,
          kind: "triple" as const,
          intuitionId: triple.tripleTermId,
          status: "published" as const,
          txHash: triple.isExisting ? null : (isStance ? stanceTxHash : tripleTxHash) ?? null,
          error: null,
        });
      }
      for (const nested of (draftPost.nestedTriples ?? [])) {
        if (seenTxPlanIds.has(nested.tripleTermId)) continue;
        seenTxPlanIds.add(nested.tripleTermId);
        txPlan.push({
          id: nested.tripleTermId,
          kind: "triple" as const,
          intuitionId: nested.tripleTermId,
          status: "published" as const,
          txHash: nested.isExisting ? null : (nestedTxHash as string | null) ?? null,
          error: null,
        });
      }
    }

    return NextResponse.json({
      posts: result.map((r) => ({
        id: r.post.id,
        publishedAt: r.post.publishedAt?.toISOString(),
      })),
      txPlan,
    });
  } catch (error: unknown) {
    console.error("Error in /api/publish:", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "An unexpected error occurred while publishing.") },
      { status: 500 },
    );
  }
}
