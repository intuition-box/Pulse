import { prisma } from "@/server/db/prisma";
import type { FeedReplyPreview } from "./HomePageClient";
import { HomePageClient } from "./HomePageClient";

export const dynamic = "force-dynamic";

/** Shared select shape for reply previews (reused in feed query + server action) */
const REPLY_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  user: { select: { displayName: true, address: true, avatar: true } },
  stance: true,
  tripleLinks: { where: { role: "MAIN" as const }, select: { termId: true } },
  _count: { select: { replies: true } },
  replies: {
    take: 1,
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      body: true,
      createdAt: true,
      user: { select: { displayName: true, address: true, avatar: true } },
      stance: true,
      tripleLinks: { where: { role: "MAIN" as const }, select: { termId: true } },
      _count: { select: { replies: true } },
    },
  },
} as const;

type RawReply = Awaited<ReturnType<typeof prisma.post.findMany<{ select: typeof REPLY_SELECT }>>>[number];

function serializeReply(r: RawReply): FeedReplyPreview {
  return {
    id: r.id,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    user: {
      displayName: r.user.displayName,
      address: r.user.address,
      avatar: r.user.avatar,
    },
    stance: r.stance as "SUPPORTS" | "REFUTES" | null,
    mainTripleTermIds: r.tripleLinks.map((l) => l.termId),
    replyCount: r._count.replies,
    subReplies: r.replies.map((sub) => ({
      id: sub.id,
      body: sub.body,
      createdAt: sub.createdAt.toISOString(),
      user: {
        displayName: sub.user.displayName,
        address: sub.user.address,
        avatar: sub.user.avatar,
      },
      stance: sub.stance as "SUPPORTS" | "REFUTES" | null,
      mainTripleTermIds: sub.tripleLinks.map((l) => l.termId),
      replyCount: sub._count.replies,
    })),
  };
}

async function loadMoreReplies(
  postId: string,
  offset: number,
): Promise<{ replies: FeedReplyPreview[]; hasMore: boolean }> {
  "use server";
  const raw = await prisma.post.findMany({
    where: { parentPostId: postId },
    orderBy: { createdAt: "desc" },
    skip: offset,
    take: 2,
    select: REPLY_SELECT,
  });
  return {
    replies: raw.map(serializeReply),
    hasMore: raw.length === 2,
  };
}

export default async function HomePage() {
  // 1. Hot debates pool: root posts with most replies (filtered client-side by sentiment)
  const trendingRaw = await prisma.post.findMany({
    where: { parentPostId: null },
    orderBy: { replies: { _count: "desc" } },
    take: 20,
    select: {
      id: true,
      body: true,
      postThemes: { select: { theme: { select: { slug: true, name: true } } } },
      tripleLinks: { where: { role: "MAIN" }, select: { termId: true } },
      replies: { select: { id: true } },
    },
  });

  // 2. Feed: root posts with 2 reply previews, sorted by latest activity
  const feedRaw = await prisma.post.findMany({
    where: { parentPostId: null },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      body: true,
      createdAt: true,
      user: { select: { displayName: true, address: true, avatar: true } },
      postThemes: { select: { theme: { select: { slug: true, name: true } } } },
      tripleLinks: { where: { role: "MAIN" }, select: { termId: true } },
      _count: { select: { replies: true } },
      replies: {
        take: 2,
        orderBy: { createdAt: "desc" },
        select: REPLY_SELECT,
      },
    },
  });

  // 3. Fetch latest reply date per thread (for "latest activity" sort)
  const rootIds = feedRaw.map((p) => p.id);
  const latestReplies = rootIds.length > 0
    ? await prisma.post.groupBy({
        by: ["parentPostId"],
        where: { parentPostId: { in: rootIds } },
        _max: { createdAt: true },
      })
    : [];
  const latestReplyMap = new Map(
    latestReplies
      .filter((r) => r.parentPostId !== null)
      .map((r) => [r.parentPostId!, r._max.createdAt]),
  );

  // 4. Themes with post counts
  const themesRaw = await prisma.theme.findMany({
    select: {
      slug: true,
      name: true,
      _count: { select: { postThemes: true } },
    },
    orderBy: { postThemes: { _count: "desc" } },
  });

  // Serialize for client
  const trending = trendingRaw.map((p) => ({
    id: p.id,
    body: p.body,
    themes: p.postThemes.map((pt) => pt.theme),
    replyCount: p.replies.length,
    mainTripleTermId: p.tripleLinks[0]?.termId ?? null,
  }));

  const feed = feedRaw.map((p) => {
    const latestReply = latestReplyMap.get(p.id);
    const latestActivityAt = latestReply && latestReply > p.createdAt
      ? latestReply.toISOString()
      : p.createdAt.toISOString();

    return {
      id: p.id,
      body: p.body,
      createdAt: p.createdAt.toISOString(),
      user: {
        displayName: p.user.displayName,
        address: p.user.address,
        avatar: p.user.avatar,
      },
      replyCount: p._count.replies,
      stance: null as "SUPPORTS" | "REFUTES" | null,
      themes: p.postThemes.map((pt) => pt.theme),
      mainTripleTermIds: p.tripleLinks.map((l) => l.termId),
      replyPreviews: p.replies.map(serializeReply),
      latestActivityAt,
      parentContext: null,
    };
  });

  const themes = themesRaw.map((t) => ({
    slug: t.slug,
    name: t.name,
    postCount: t._count.postThemes,
  }));

  return (
    <HomePageClient
      trending={trending}
      feed={feed}
      themes={themes}
      loadMoreReplies={loadMoreReplies}
    />
  );
}
