import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveTripleIdsByLabels } from "@/lib/intuition/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  labels: z
    .array(
      z.object({
        s: z.string().min(1),
        p: z.string().min(1),
        o: z.string().min(1),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  try {
    const byLabelKey = await resolveTripleIdsByLabels(parsed.data.labels);
    return NextResponse.json({ byLabelKey });
  } catch {
    return NextResponse.json(
      { error: "Label resolution failed." },
      { status: 502 },
    );
  }
}
