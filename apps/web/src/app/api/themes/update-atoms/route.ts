import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireSiweAuth } from "@/server/auth/siwe";
import { getErrorMessage } from "@/lib/getErrorMessage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX_ID_REGEX = /^0x[a-fA-F0-9]{1,128}$/;

type UpdateEntry = { slug: string; atomTermId: string };

export async function POST(request: Request) {
  try {
    try {
      await requireSiweAuth(request);
    } catch (error: unknown) {
      return NextResponse.json(
        { error: getErrorMessage(error, "Unauthorized.") },
        { status: 401 },
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const { updates } = body as { updates?: UpdateEntry[] };
    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: "updates array is required." }, { status: 400 });
    }
    if (updates.length > 50) {
      return NextResponse.json({ error: "Maximum 50 updates per request." }, { status: 400 });
    }

    const results: { slug: string; updated: boolean }[] = [];

    for (const entry of updates) {
      if (!entry.slug || typeof entry.slug !== "string") continue;
      if (!entry.atomTermId || !HEX_ID_REGEX.test(entry.atomTermId)) continue;

      const updated = await prisma.theme.updateMany({
        where: { slug: entry.slug, atomTermId: null },
        data: { atomTermId: entry.atomTermId },
      });

      results.push({ slug: entry.slug, updated: updated.count > 0 });
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Error in POST /api/themes/update-atoms:", error);
    return NextResponse.json({ error: "Failed to update theme atoms." }, { status: 500 });
  }
}
