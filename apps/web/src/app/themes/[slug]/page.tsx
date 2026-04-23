import { notFound } from "next/navigation";

import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

import { ThemePageClient } from "./ThemePageClient";

type ThemePageProps = {
  params: Promise<{ slug: string }>;
};

export default async function ThemePage({ params }: ThemePageProps) {
  const { slug } = await params;

  const theme = await prisma.theme.findUnique({
    where: { slug },
  });

  if (!theme) {
    notFound();
  }

  const rootPosts = await prisma.post.findMany({
    where: {
      postThemes: { some: { themeSlug: theme.slug } },
      parentPostId: null, // Root posts only
    },
    orderBy: { createdAt: "desc" },
    include: {
      replies: { select: { id: true } }, // Count replies
      user: { select: { displayName: true, address: true, avatar: true } },
      postThemes: { include: { theme: { select: { slug: true, name: true } } } },
      tripleLinks: {
        where: { role: "MAIN" },
        orderBy: { createdAt: "asc" },
        select: { termId: true },
      },
    },
  });

  const rootSummaries = rootPosts.map((post) => ({
    id: post.id,
    body: post.body,
    createdAt: post.createdAt.toISOString(),
    replyCount: post.replies.length,
    user: {
      displayName: post.user.displayName,
      address: post.user.address,
      avatar: post.user.avatar,
    },
    themes: post.postThemes.map((pt) => ({ slug: pt.theme.slug, name: pt.theme.name })),
    mainTripleTermIds: post.tripleLinks.map(l => l.termId),
  }));

  return (
    <ThemePageClient
      theme={{ slug: theme.slug, name: theme.name, atomTermId: theme.atomTermId ?? null }}
      rootPosts={rootSummaries}
    />
  );
}
