import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/server/auth/session";
import { disconnectSocial } from "@/server/auth/oauth";

export async function DELETE(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  await disconnectSocial(session.userId, "discord");
  return NextResponse.json({ ok: true });
}
