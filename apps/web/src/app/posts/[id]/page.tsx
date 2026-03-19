import { notFound } from "next/navigation";

import { prisma } from "@/server/db/prisma";
import { PostPageClient } from "./PostPageClient";

type PostPageProps = {
  params: Promise<{ id: string }>;
};

async function getPostBreadcrumbs(postId: string, maxDepth = 5) {
  const breadcrumbs: { id: string; body: string }[] = [];
  let cursor = postId;
  const seen = new Set<string>();

  while (cursor && breadcrumbs.length < maxDepth) {
    if (seen.has(cursor)) break;
    seen.add(cursor);

    const currentPost = await prisma.post.findUnique({
      where: { id: cursor },
      select: { id: true, body: true, parentPostId: true },
    });

    if (!currentPost?.parentPostId) break;
    breadcrumbs.push({ id: currentPost.parentPostId, body: "" });
    cursor = currentPost.parentPostId;
  }

  // Batch-fetch parent post bodies
  if (breadcrumbs.length > 0) {
    const parentIds = breadcrumbs.map(b => b.id);
    const parents = await prisma.post.findMany({
      where: { id: { in: parentIds } },
      select: { id: true, body: true },
    });
    const bodyMap = new Map(parents.map(p => [p.id, p.body]));
    for (const bc of breadcrumbs) {
      bc.body = bodyMap.get(bc.id) ?? "";
    }
  }

  return breadcrumbs.reverse();
}

export default async function PostPage({ params }: PostPageProps) {
  const { id } = await params;

  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      postThemes: { select: { theme: { select: { slug: true, name: true } } } },
      tripleLinks: {
        select: { termId: true, role: true },
      },
      replies: {
        select: {
          id: true,
          body: true,
          createdAt: true,
          parentPostId: true,
          stance: true,
          user: { select: { displayName: true, address: true, avatar: true } },
          tripleLinks: {
            where: { role: "MAIN" },
            orderBy: { createdAt: "asc" },
            select: { termId: true },
          },
        },
      },
    },
  });

  if (!post) {
    notFound();
  }

  const breadcrumbs = await getPostBreadcrumbs(post.id);

  // Batch queries instead of N+1
  const replyIds = post.replies.map(r => r.id);

  const [nestedCounts] = await Promise.all([
    prisma.post.groupBy({
      by: ["parentPostId"],
      where: { parentPostId: { in: replyIds } },
      _count: true,
    }),
  ]);

  const countMap = new Map(nestedCounts.map(c => [c.parentPostId, c._count]));

  const replySummaries = post.replies.map((reply) => ({
    id: reply.id,
    body: reply.body,
    createdAt: reply.createdAt.toISOString(),
    stance: reply.stance ?? null,
    replyCount: countMap.get(reply.id) ?? 0,
    mainTripleTermIds: reply.tripleLinks.map(l => l.termId),
    author: {
      displayName: reply.user.displayName,
      address: reply.user.address,
      avatar: reply.user.avatar,
    },
  }));

  const linkedTriples = post.tripleLinks.map((link) => ({
    termId: link.termId,
    role: link.role,
  }));

  return (
    <PostPageClient
      post={{
        id: post.id,
        body: post.body,
        createdAt: post.createdAt.toISOString(),
        tripleLinks: linkedTriples,
      }}
      themes={post.postThemes.map((pt) => pt.theme)}
      breadcrumbs={breadcrumbs}
      replies={replySummaries}
    />
  );
}
