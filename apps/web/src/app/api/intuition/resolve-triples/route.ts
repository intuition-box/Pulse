import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAddress } from "viem";

import { resolveTripleIds } from "@/lib/intuition/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  address: z.string().refine(isAddress, "Invalid address"),
  combinations: z
    .array(z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]))
    .min(1)
    .max(300),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid payload", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }

    const { address, combinations } = parsed.data;

    // Anti-abuse logging
    if (combinations.length > 50) {
      console.warn(
        `[resolve-triples] large request: ${combinations.length} combinations from ${request.headers.get("x-forwarded-for") ?? "unknown"}`,
      );
    }

    const byKey = await resolveTripleIds(address, combinations);

    return NextResponse.json({ byKey });
  } catch (error) {
    console.error("POST /api/intuition/resolve-triples failed:", error);
    return NextResponse.json(
      { error: "Failed to resolve triple IDs", code: "RESOLVE_TRIPLES_FAILED" },
      { status: 502 },
    );
  }
}
