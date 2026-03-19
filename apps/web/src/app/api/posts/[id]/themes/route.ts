import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireSiweAuth } from "@/server/auth/siwe";
import { getErrorMessage } from "@/lib/getErrorMessage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/posts/[id]/themes
 * Add a theme to an existing post.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    try {
      await requireSiweAuth(request);
    } catch (error: unknown) {
      return NextResponse.json(
        { error: getErrorMessage(error, "Unauthorized.") },
        { status: 401 },
      );
    }

    const { id: postId } = await context.params;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const { themeSlug } = body as { themeSlug?: string };
    if (!themeSlug || typeof themeSlug !== "string") {
      return NextResponse.json({ error: "themeSlug is required." }, { status: 400 });
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });
    if (!post) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }

    const theme = await prisma.theme.findUnique({
      where: { slug: themeSlug },
      select: { slug: true, name: true },
    });
    if (!theme) {
      return NextResponse.json({ error: "Theme not found." }, { status: 404 });
    }

    await prisma.postTheme.upsert({
      where: {
        postId_themeSlug: { postId, themeSlug },
      },
      create: { postId, themeSlug },
      update: {},
    });

    return NextResponse.json({
      ok: true,
      theme: { slug: theme.slug, name: theme.name },
    });
  } catch (error) {
    console.error("Error in POST /api/posts/[id]/themes:", error);
    return NextResponse.json({ error: "Failed to add theme." }, { status: 500 });
  }
}
