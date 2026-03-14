import { NextResponse } from "next/server";

import { readMultivaultConfig } from "@/lib/intuition/resolve";

export const runtime = "nodejs";

export async function GET() {
  try {
    const config = await readMultivaultConfig();

    return NextResponse.json(config, {
      headers: { "Cache-Control": "public, s-maxage=60" },
    });
  } catch (error) {
    console.error("GET /api/intuition/config failed:", error);
    return NextResponse.json(
      { error: "Failed to read multivault config", code: "CONFIG_FAILED" },
      { status: 502 },
    );
  }
}
