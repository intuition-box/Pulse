import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveAtomIds, resolveAtomLabelsById } from "@/lib/intuition/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  labels: z.array(z.string().trim().min(1).max(500)).max(300).default([]),
  atomIds: z.array(z.string().trim().min(1).max(200)).max(300).default([]),
}).refine((d) => d.labels.length > 0 || d.atomIds.length > 0, {
  message: "At least one of labels or atomIds must be provided",
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

    const atoms = parsed.data.labels.length > 0
      ? await resolveAtomIds(parsed.data.labels)
      : [];
    const atomsById = parsed.data.atomIds.length > 0
      ? await resolveAtomLabelsById(parsed.data.atomIds)
      : [];

    return NextResponse.json({ atoms, atomsById });
  } catch (error) {
    console.error("POST /api/intuition/resolve-atoms failed:", error);
    return NextResponse.json(
      { error: "Failed to resolve atom IDs", code: "RESOLVE_ATOMS_FAILED" },
      { status: 502 },
    );
  }
}
