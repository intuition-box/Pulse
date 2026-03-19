import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const { slugs } = body as { slugs?: string[] };
    if (!Array.isArray(slugs) || slugs.length === 0) {
      return NextResponse.json({ error: "slugs array is required." }, { status: 400 });
    }
    if (slugs.length > 50) {
      return NextResponse.json({ error: "Maximum 50 slugs per request." }, { status: 400 });
    }

    const themes = await prisma.theme.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true, name: true, atomTermId: true },
    });

    return NextResponse.json({ themes });
  } catch (error) {
    console.error("Error in POST /api/themes/resolve:", error);
    return NextResponse.json({ error: "Failed to resolve themes." }, { status: 500 });
  }
}
