import { NextResponse } from "next/server";
import { getTripleMetricsByIds } from "@/lib/intuition/tripleMetrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = { tripleTermIds?: unknown };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Payload | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const ids = body.tripleTermIds;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "tripleTermIds must be a string array." }, { status: 400 });
  }

  if (ids.length === 0) {
    return NextResponse.json({ metrics: {} });
  }

  if (ids.length > 50) {
    return NextResponse.json({ error: "Too many IDs (max 50)." }, { status: 400 });
  }

  try {
    const metrics = await getTripleMetricsByIds(ids);
    return NextResponse.json({ metrics });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch triple metrics.", metrics: {} },
      { status: 502 },
    );
  }
}
