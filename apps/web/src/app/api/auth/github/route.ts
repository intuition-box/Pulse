import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/server/auth/session";
import { createOAuthStateCookie, getRedirectBase } from "@/server/auth/oauth";

export async function GET(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const { state, cookieHeader } = createOAuthStateCookie("github");
  const redirectBase = getRedirectBase();

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: `${redirectBase}/api/auth/github/callback`,
    scope: "read:user user:email",
    state,
  });

  const response = NextResponse.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`,
  );
  response.headers.append("Set-Cookie", cookieHeader);
  return response;
}
