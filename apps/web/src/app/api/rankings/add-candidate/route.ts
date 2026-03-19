import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireSiweAuth } from "@/server/auth/siwe";
import { getErrorMessage } from "@/lib/getErrorMessage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    let auth: { userId: string };
    try {
      auth = await requireSiweAuth(request);
    } catch {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
    }

    const { body, tripleTermId, themeSlug } = raw as {
      body?: string;
      tripleTermId?: string;
      themeSlug?: string;
    };

    if (!body || !tripleTermId || !themeSlug) {
      return NextResponse.json({ error: "body, tripleTermId, and themeSlug are required." }, { status: 400 });
    }

    const theme = await prisma.theme.findUnique({ where: { slug: themeSlug } });
    if (!theme) {
      return NextResponse.json({ error: "Theme not found." }, { status: 404 });
    }

    const existing = await prisma.postTripleLink.findFirst({
      where: { termId: tripleTermId, role: "MAIN" },
      select: { postId: true },
    });
    if (existing) {
      return NextResponse.json({ postId: existing.postId });
    }

    const post = await prisma.$transaction(async (tx) => {
      const newPost = await tx.post.create({
        data: {
          userId: auth.userId,
          body,
          publishedAt: new Date(),
          postThemes: {
            create: { themeSlug },
          },
        },
      });

      await tx.postTripleLink.create({
        data: {
          postId: newPost.id,
          termId: tripleTermId,
          role: "MAIN",
        },
      });

      return newPost;
    });

    return NextResponse.json({ postId: post.id });
  } catch (error: unknown) {
    console.error("Error in /api/rankings/add-candidate:", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to create candidate post.") },
      { status: 500 },
    );
  }
}
