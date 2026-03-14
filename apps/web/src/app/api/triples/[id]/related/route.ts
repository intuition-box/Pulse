import { NextResponse } from "next/server";
import { getTripleDetails } from "@0xintuition/sdk";
import { ensureIntuitionGraphql } from "@/lib/intuition";
import { fetchTriplesBySharedTopicAtoms } from "@/lib/intuition/graphql-queries";
import { resolveAtomLabel } from "@/lib/intuition/resolveTerm";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ id: string }>;
};

type RelatedPost = {
  id: string;
  body: string;
  createdAt: string;
  replyCount: number;
  author: {
    displayName: string | null;
    address: string;
    avatar: string | null;
  };
  mainTripleTermId: string;
  score?: 1 | 2 | 3;
  sharedTopics?: string[];
};

export async function GET(request: Request, { params }: RouteProps) {
  const { id: tripleTermId } = await params;
  const exclude = new URL(request.url).searchParams.get("exclude");

  if (!tripleTermId || typeof tripleTermId !== "string") {
    return NextResponse.json({ error: "Invalid triple ID." }, { status: 400 });
  }

  try {

    ensureIntuitionGraphql();
    const details = await getTripleDetails(tripleTermId);

    if (!details) {
      return NextResponse.json({ error: "Triple not found." }, { status: 404 });
    }

    const sourceSubjectId = details.subject_id ? String(details.subject_id) : null;
    const sourceObjectId = details.object_id ? String(details.object_id) : null;
    const [subjectResolved, objectResolved] = await Promise.all([
      resolveAtomLabel(details.subject, details.subject_id ? String(details.subject_id) : null),
      resolveAtomLabel(details.object, details.object_id ? String(details.object_id) : null),
    ]);
    const sourceSubjectLabel = subjectResolved.label;
    const sourceObjectLabel = objectResolved.label;

    const exactLinks = await prisma.postTripleLink.findMany({
      where: {
        termId: tripleTermId,
        role: "MAIN",
        ...(exclude ? { postId: { not: exclude } } : {}),
      },
      include: {
        post: {
          select: {
            id: true,
            body: true,
            createdAt: true,
            user: { select: { displayName: true, address: true, avatar: true } },
            _count: { select: { replies: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const exactPosts: RelatedPost[] = exactLinks.map((link) => ({
      id: link.post.id,
      body: link.post.body,
      createdAt: link.post.createdAt.toISOString(),
      replyCount: link.post._count.replies,
      author: {
        displayName: link.post.user.displayName,
        address: link.post.user.address,
        avatar: link.post.user.avatar,
      },
      mainTripleTermId: link.termId,
    }));
    const exactPostIds = new Set(exactPosts.map((p) => p.id));

    const atomIds = [sourceSubjectId, sourceObjectId].filter((id): id is string => id != null);
    const candidateTriples = atomIds.length > 0
      ? await fetchTriplesBySharedTopicAtoms(atomIds, tripleTermId, 30)
      : [];

    if (candidateTriples.length === 0) {
      return NextResponse.json({ exact: exactPosts, related: [] });
    }

    const candidateTermIds = candidateTriples
      .map((t) => t.term_id)
      .filter((id): id is string => id != null);

    const relatedLinks = await prisma.postTripleLink.findMany({
      where: {
        termId: { in: candidateTermIds },
        role: "MAIN",
        ...(exclude ? { postId: { not: exclude } } : {}),
      },
      include: {
        post: {
          select: {
            id: true,
            body: true,
            createdAt: true,
            user: { select: { displayName: true, address: true, avatar: true } },
            _count: { select: { replies: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const tripleScores = new Map<string, { score: number; sharedTopics: Map<string, string> }>();
    for (const triple of candidateTriples) {
      const tid = triple.term_id;
      if (!tid) continue;

      let score = 0;
      const topics = new Map<string, string>();

      const candidateSubjectId = triple.subject?.term_id ? String(triple.subject.term_id) : null;
      const candidateObjectId = triple.object?.term_id ? String(triple.object.term_id) : null;

      if (
        (sourceSubjectId && candidateSubjectId === sourceSubjectId) ||
        (sourceSubjectId && candidateObjectId === sourceSubjectId)
      ) {
        score += 2;
        if (sourceSubjectLabel) topics.set(sourceSubjectId!, sourceSubjectLabel);
      }

      if (
        (sourceObjectId && candidateObjectId === sourceObjectId) ||
        (sourceObjectId && candidateSubjectId === sourceObjectId)
      ) {
        score += 1;
        if (sourceObjectLabel) topics.set(sourceObjectId!, sourceObjectLabel);
      }

      tripleScores.set(tid, { score, sharedTopics: topics });
    }

    const postMap = new Map<string, RelatedPost>();
    for (const link of relatedLinks) {
      const postId = link.post.id;
      if (exactPostIds.has(postId)) continue;

      const scoreData = tripleScores.get(link.termId);
      if (!scoreData || scoreData.score === 0) continue;

      const existing = postMap.get(postId);
      if (!existing || scoreData.score > (existing.score ?? 0)) {
        const sharedTopics = [...scoreData.sharedTopics.values()];
        postMap.set(postId, {
          id: link.post.id,
          body: link.post.body,
          createdAt: link.post.createdAt.toISOString(),
          replyCount: link.post._count.replies,
          author: {
            displayName: link.post.user.displayName,
            address: link.post.user.address,
            avatar: link.post.user.avatar,
          },
          mainTripleTermId: link.termId,
          score: Math.min(scoreData.score, 3) as 1 | 2 | 3,
          sharedTopics: sharedTopics.length > 0 ? sharedTopics : undefined,
        });
      }
    }

    const relatedPosts = [...postMap.values()].sort((a, b) => {
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return NextResponse.json({ exact: exactPosts, related: relatedPosts });
  } catch (error) {
    console.error("[GET /api/triples/[id]/related] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch related posts." },
      { status: 500 },
    );
  }
}
