import { NextResponse } from "next/server";
import { getTripleDetails } from "@0xintuition/sdk";
import { ensureIntuitionGraphql } from "@/lib/intuition";
import {
  fetchTriplesBySharedTopicAtoms,
  fetchTriplesByLabel,
  fetchSemanticAtoms,
  type GraphqlTriple,
} from "@/lib/intuition/graphql-queries";
import { resolveAtomLabel } from "@/lib/intuition/resolveTerm";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PER_BUCKET = 10;

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
  sharedAtom?: string;
};

const POST_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  user: { select: { displayName: true, address: true, avatar: true } },
  _count: { select: { replies: true } },
} as const;

type PostRow = {
  id: string;
  body: string;
  createdAt: Date;
  user: { displayName: string | null; address: string; avatar: string | null };
  _count: { replies: number };
};

function toRelatedPost(
  post: PostRow,
  termId: string,
  sharedAtom?: string,
): RelatedPost {
  return {
    id: post.id,
    body: post.body,
    createdAt: post.createdAt.toISOString(),
    replyCount: post._count.replies,
    author: {
      displayName: post.user.displayName,
      address: post.user.address,
      avatar: post.user.avatar,
    },
    mainTripleTermId: termId,
    ...(sharedAtom ? { sharedAtom } : {}),
  };
}

/** Deduplicated, non-null array of IDs */
function uniqueIds(...ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id != null))];
}

/** Find posts linked to candidate triples, deduplicating against seenPostIds */
async function findPostsForTriples(
  tripleToLabel: Map<string, string>,
  seenPostIds: Set<string>,
  excludeFilter: Record<string, unknown>,
): Promise<RelatedPost[]> {
  if (tripleToLabel.size === 0) return [];

  const links = await prisma.postTripleLink.findMany({
    where: {
      termId: { in: [...tripleToLabel.keys()] },
      role: "MAIN",
      ...excludeFilter,
    },
    include: { post: { select: POST_SELECT } },
    orderBy: { createdAt: "desc" },
  });

  const posts: RelatedPost[] = [];
  for (const link of links) {
    if (seenPostIds.has(link.post.id)) continue;
    if (posts.length >= MAX_PER_BUCKET) break;
    seenPostIds.add(link.post.id);
    posts.push(
      toRelatedPost(link.post, link.termId, tripleToLabel.get(link.termId)),
    );
  }
  return posts;
}

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

    // Resolve labels (+ detect nesting)
    const [subjectResolved, objectResolved] = await Promise.all([
      resolveAtomLabel(details.subject, sourceSubjectId),
      resolveAtomLabel(details.object, sourceObjectId),
    ]);
    const sourceSubjectLabel = subjectResolved.label;
    const sourceObjectLabel = objectResolved.label;

    // If subject or object is itself a nested triple, get its subject atom ID
    const [nestedSubjectAtomId, nestedObjectSubjectAtomId] = await Promise.all([
      subjectResolved.nestedTriple && sourceSubjectId
        ? getTripleDetails(sourceSubjectId).then((d) =>
            d?.subject_id ? String(d.subject_id) : null,
          ).catch(() => null)
        : Promise.resolve(null),
      objectResolved.nestedTriple && sourceObjectId
        ? getTripleDetails(sourceObjectId).then((d) =>
            d?.subject_id ? String(d.subject_id) : null,
          ).catch(() => null)
        : Promise.resolve(null),
    ]);

    const excludeFilter = exclude ? { postId: { not: exclude } } : {};
    const seenPostIds = new Set<string>();
    if (exclude) seenPostIds.add(exclude);

    // 1. Exact: posts using the exact same triple
    const exactLinks = await prisma.postTripleLink.findMany({
      where: { termId: tripleTermId, role: "MAIN", ...excludeFilter },
      include: { post: { select: POST_SELECT } },
      orderBy: { createdAt: "desc" },
      take: MAX_PER_BUCKET,
    });

    const exactPosts: RelatedPost[] = exactLinks.map((link) =>
      toRelatedPost(link.post, link.termId),
    );
    for (const p of exactPosts) seenPostIds.add(p.id);

    const subjectSearchIds = uniqueIds(sourceSubjectId, tripleTermId, nestedSubjectAtomId);
    const objectSearchIds = uniqueIds(sourceObjectId, nestedObjectSubjectAtomId);
    const objectOnlyIds = objectSearchIds.filter((id) => !subjectSearchIds.includes(id));

    const labelSearchTerms = [sourceSubjectLabel, sourceObjectLabel]
      .filter((l) => l && l.length >= 2 && l !== "Unknown");

    // Pass 1 — by atom ID + by label (parallel)
    const [pass1Subject, pass1Object, pass1Label, semanticAtoms] = await Promise.all([
      subjectSearchIds.length > 0
        ? fetchTriplesBySharedTopicAtoms(subjectSearchIds, tripleTermId, 50)
        : Promise.resolve([] as GraphqlTriple[]),
      objectOnlyIds.length > 0
        ? fetchTriplesBySharedTopicAtoms(objectOnlyIds, tripleTermId, 50)
        : Promise.resolve([] as GraphqlTriple[]),
      labelSearchTerms.length > 0
        ? fetchTriplesByLabel(labelSearchTerms, tripleTermId, 50)
        : Promise.resolve([] as GraphqlTriple[]),
      sourceSubjectLabel
        ? fetchSemanticAtoms(sourceSubjectLabel, 10).catch(() => [])
        : Promise.resolve([]),
    ]);

    // Dedup pass1 by term_id
    const seen1 = new Set<string>();
    const dedup = (triples: GraphqlTriple[]) =>
      triples.filter((t) => {
        if (!t.term_id || seen1.has(t.term_id)) return false;
        seen1.add(t.term_id);
        return true;
      });
    const allPass1 = dedup([...pass1Subject, ...pass1Object, ...pass1Label]);

    // Pass 2 — triples nesting any pass 1 triple
    const pass1Ids = allPass1
      .map((t) => t.term_id!)
      .filter((id) => !subjectSearchIds.includes(id) && !objectSearchIds.includes(id));

    const pass2 = pass1Ids.length > 0
      ? await fetchTriplesBySharedTopicAtoms(pass1Ids, tripleTermId, 50)
      : [];

    const allCandidates = [...allPass1, ...pass2];
    const subjectCandidates = allCandidates;
    const objectCandidates = allCandidates;

    const pass1SubjectIds = new Set(
      pass1Subject.map((t) => t.term_id).filter((id): id is string => id != null),
    );
    const pass1ObjectIds = new Set(
      pass1Object.map((t) => t.term_id).filter((id): id is string => id != null),
    );

    // Match subject: atom ID match, label match (via pass1Label), nesting, pass 2
    const sameSubjectMap = new Map<string, string>();
    for (const t of allCandidates) {
      const tid = t.term_id;
      if (!tid) continue;
      const sid = t.subject?.term_id ? String(t.subject.term_id) : null;
      const oid = t.object?.term_id ? String(t.object.term_id) : null;
      const sLabel = t.subject?.label?.toLowerCase() ?? "";
      const oLabel = t.object?.label?.toLowerCase() ?? "";
      const srcLabel = sourceSubjectLabel.toLowerCase();

      if (
        sid === sourceSubjectId || oid === sourceSubjectId ||
        sid === tripleTermId || oid === tripleTermId ||
        (nestedSubjectAtomId && (sid === nestedSubjectAtomId || oid === nestedSubjectAtomId)) ||
        ((sid && pass1SubjectIds.has(sid)) || (oid && pass1SubjectIds.has(oid))) ||
        sLabel === srcLabel || oLabel === srcLabel
      ) {
        sameSubjectMap.set(tid, sourceSubjectLabel);
      }
    }
    const sameSubjectPosts = await findPostsForTriples(
      sameSubjectMap,
      seenPostIds,
      excludeFilter,
    );

    const sameObjectMap = new Map<string, string>();

    for (const t of allCandidates) {
      const tid = t.term_id;
      if (!tid || sameSubjectMap.has(tid)) continue;
      const sid = t.subject?.term_id ? String(t.subject.term_id) : null;
      const oid = t.object?.term_id ? String(t.object.term_id) : null;
      const sLabel = t.subject?.label?.toLowerCase() ?? "";
      const oLabel = t.object?.label?.toLowerCase() ?? "";
      const srcLabel = sourceObjectLabel.toLowerCase();

      if (
        oid === sourceObjectId || sid === sourceObjectId ||
        (nestedObjectSubjectAtomId && (sid === nestedObjectSubjectAtomId || oid === nestedObjectSubjectAtomId)) ||
        ((sid && pass1ObjectIds.has(sid)) || (oid && pass1ObjectIds.has(oid))) ||
        sLabel === srcLabel || oLabel === srcLabel
      ) {
        sameObjectMap.set(tid, sourceObjectLabel);
      }
    }
    const sameObjectPosts = await findPostsForTriples(
      sameObjectMap,
      seenPostIds,
      excludeFilter,
    );

    // Build related bucket (semantic atoms)
    let relatedPosts: RelatedPost[] = [];

    const allStructuralIds = new Set([...subjectSearchIds, ...objectSearchIds]);
    const semanticAtomIds = semanticAtoms
      .map((a) => (a.term_id ? String(a.term_id) : null))
      .filter((id): id is string => id != null && !allStructuralIds.has(id));

    if (semanticAtomIds.length > 0) {
      const semanticTriples = await fetchTriplesBySharedTopicAtoms(
        semanticAtomIds,
        tripleTermId,
        50,
      );

      const semanticIdSet = new Set(semanticAtomIds);
      const atomLabelMap = new Map<string, string>();
      for (const a of semanticAtoms) {
        if (a.term_id && a.label) atomLabelMap.set(String(a.term_id), a.label);
      }

      const semanticMap = new Map<string, string>();
      for (const t of semanticTriples) {
        const tid = t.term_id;
        if (!tid || sameSubjectMap.has(tid) || sameObjectMap.has(tid)) continue;
        const sid = t.subject?.term_id ? String(t.subject.term_id) : null;
        const oid = t.object?.term_id ? String(t.object.term_id) : null;
        const matchedId = sid && semanticIdSet.has(sid) ? sid
          : oid && semanticIdSet.has(oid) ? oid
          : null;
        if (matchedId) {
          semanticMap.set(tid, atomLabelMap.get(matchedId) ?? "");
        }
      }

      relatedPosts = await findPostsForTriples(
        semanticMap,
        seenPostIds,
        excludeFilter,
      );
    }

    return NextResponse.json({
      exact: exactPosts,
      sameSubject: sameSubjectPosts,
      sameObject: sameObjectPosts,
      related: relatedPosts,
    });
  } catch (error) {
    console.error("[GET /api/triples/[id]/related] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch related posts." },
      { status: 500 },
    );
  }
}
