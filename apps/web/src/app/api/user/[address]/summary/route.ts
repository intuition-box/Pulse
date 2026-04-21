import { NextResponse } from "next/server";

import { prisma } from "@/server/db/prisma";

const PROFILE_SELECT = {
  id: true,
  displayName: true,
  avatar: true,
  bio: true,
  address: true,
  discordName: true,
  githubName: true,
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const normalized = address.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { address: normalized },
    select: PROFILE_SELECT,
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const [postCount, totalSupportsReceived] = await Promise.all([
    prisma.post.count({ where: { userId: user.id } }),
    prisma.post.count({
      where: {
        stance: "SUPPORTS",
        parent: { userId: user.id },
      },
    }),
  ]);

  return NextResponse.json(
    {
      displayName: user.displayName,
      avatar: user.avatar,
      bio: user.bio,
      address: user.address,
      discord: user.discordName,
      github: user.githubName,
      postCount,
      totalSupportsReceived,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
