import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/server/auth/session";
import { createOAuthStateCookie, getRedirectBase } from "@/server/auth/oauth";

export async function GET(request: Request) {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    console.error("[discord] Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET env vars");
    return NextResponse.redirect(new URL("/", request.url));
  }

  const session = getSessionFromRequest(request);
  if (!session) {
    console.error("[discord] No SIWE session found — user must connect wallet first");
    return NextResponse.redirect(new URL("/", request.url));
  }

  const { state, cookieHeader } = createOAuthStateCookie("discord");
  const redirectBase = getRedirectBase();

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID!,
    redirect_uri: `${redirectBase}/api/auth/discord/callback`,
    response_type: "code",
    scope: "identify email",
    state,
  });

  const response = NextResponse.redirect(
    `https://discord.com/api/oauth2/authorize?${params.toString()}`,
  );
  response.headers.append("Set-Cookie", cookieHeader);
  return response;
}
