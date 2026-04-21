import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/server/auth/session";
import {
  verifyOAuthState,
  clearOAuthCookie,
  updateUserSocial,
  getRedirectBase,
  oauthPopupResponse,
  oauthPopupErrorResponse,
} from "@/server/auth/oauth";

type GitHubUser = {
  id: number;
  login: string;
  avatar_url: string;
  email?: string | null;
};

export async function GET(request: Request) {
  const homeUrl = new URL("/", request.url);
  const origin = new URL(request.url).origin;
  const cookie = clearOAuthCookie("github");

  const state = verifyOAuthState(request, "github");
  if (!state) {
    return NextResponse.redirect(homeUrl);
  }

  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.redirect(homeUrl);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    const error = url.searchParams.get("error") || "no_code";
    return oauthPopupErrorResponse(origin, "github", error, cookie);
  }

  const redirectBase = getRedirectBase();

  try {
    const tokenRes = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${redirectBase}/api/auth/github/callback`,
        }),
      },
    );

    if (!tokenRes.ok) {
      console.error("[github] token exchange failed:", tokenRes.status);
      return oauthPopupErrorResponse(origin, "github", "token_exchange_failed", cookie);
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };
    if (!tokenData.access_token) {
      return oauthPopupErrorResponse(origin, "github", "no_access_token", cookie);
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!userRes.ok) {
      console.error("[github] user fetch failed:", userRes.status);
      return oauthPopupErrorResponse(origin, "github", "user_fetch_failed", cookie);
    }

    const githubUser = (await userRes.json()) as GitHubUser;

    await updateUserSocial(session.userId, "github", {
      providerId: String(githubUser.id),
      name: githubUser.login,
      avatar: githubUser.avatar_url || null,
      email: githubUser.email ?? null,
    });

    return oauthPopupResponse(origin, "github", cookie);
  } catch (error) {
    console.error("[github] callback error:", error);
    return oauthPopupErrorResponse(origin, "github", "unexpected_error", cookie);
  }
}
