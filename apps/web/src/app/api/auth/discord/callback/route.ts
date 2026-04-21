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

type DiscordUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  email?: string | null;
};

function buildAvatarUrl(user: DiscordUser): string {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
  }
  const index = (BigInt(user.id) >> 22n) % 6n;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export async function GET(request: Request) {
  const homeUrl = new URL("/", request.url);
  const origin = new URL(request.url).origin;
  const cookie = clearOAuthCookie("discord");

  const state = verifyOAuthState(request, "discord");
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
    return oauthPopupErrorResponse(origin, "discord", error, cookie);
  }

  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    return oauthPopupErrorResponse(origin, "discord", "missing_config", cookie);
  }

  const redirectBase = getRedirectBase();

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${redirectBase}/api/auth/discord/callback`,
      }),
    });

    if (!tokenRes.ok) {
      console.error("[discord] token exchange failed:", tokenRes.status);
      return oauthPopupErrorResponse(origin, "discord", "token_exchange_failed", cookie);
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };
    if (!tokenData.access_token) {
      return oauthPopupErrorResponse(origin, "discord", "no_access_token", cookie);
    }

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      console.error("[discord] user fetch failed:", userRes.status);
      return oauthPopupErrorResponse(origin, "discord", "user_fetch_failed", cookie);
    }

    const discordUser = (await userRes.json()) as DiscordUser;

    await updateUserSocial(session.userId, "discord", {
      providerId: discordUser.id,
      name: discordUser.global_name || discordUser.username,
      avatar: buildAvatarUrl(discordUser),
      email: discordUser.email ?? null,
    });

    return oauthPopupResponse(origin, "discord", cookie);
  } catch (error) {
    console.error("[discord] callback error:", error);
    return oauthPopupErrorResponse(origin, "discord", "unexpected_error", cookie);
  }
}
