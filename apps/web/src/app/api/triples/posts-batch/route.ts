import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const termIds: string[] = body?.termIds;

    if (!Array.isArray(termIds) || termIds.length === 0) {
      return NextResponse.json({});
    }

    const links = await prisma.postTripleLink.findMany({
      where: { termId: { in: termIds }, role: "MAIN" },
      select: { termId: true, postId: true },
      orderBy: { createdAt: "desc" },
    });

    const map: Record<string, string> = {};
    for (const link of links) {
      if (!map[link.termId]) {
        map[link.termId] = link.postId;
      }
    }

    return NextResponse.json(map);
  } catch {
    return NextResponse.json({}, { status: 500 });
  }
}
