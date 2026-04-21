import { randomBytes, createHash } from "crypto";

import { prisma } from "@/server/db/prisma";

export type OAuthProvider = "discord" | "github";

const OAUTH_COOKIE_TTL_S = 5 * 60;

// SameSite=Lax (not Strict) because the callback is a redirect FROM the provider.
export function createOAuthStateCookie(provider: string): {
  state: string;
  cookieHeader: string;
} {
  const state = randomBytes(16).toString("hex");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookieHeader = `dm_oauth_${provider}=${state}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=${OAUTH_COOKIE_TTL_S}`;
  return { state, cookieHeader };
}

export function verifyOAuthState(
  request: Request,
  provider: string,
): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const cookieName = `dm_oauth_${provider}`;
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`),
  );
  if (!match) return null;

  const url = new URL(request.url);
  const stateParam = url.searchParams.get("state");
  if (!stateParam || stateParam !== match[1]) return null;

  return stateParam;
}

export function clearOAuthCookie(provider: string): string {
  return `dm_oauth_${provider}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createPkceCookie(provider: string): {
  state: string;
  codeVerifier: string;
  cookieHeader: string;
} {
  const state = randomBytes(16).toString("hex");
  const codeVerifier = generateCodeVerifier();
  const payload = JSON.stringify({ state, codeVerifier });
  const encoded = Buffer.from(payload).toString("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookieHeader = `dm_oauth_${provider}=${encoded}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=${OAUTH_COOKIE_TTL_S}`;
  return { state, codeVerifier, cookieHeader };
}

export function verifyPkceCookie(
  request: Request,
  provider: string,
): { state: string; codeVerifier: string } | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const cookieName = `dm_oauth_${provider}`;
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`),
  );
  if (!match) return null;

  try {
    const decoded = Buffer.from(match[1], "base64url").toString("utf8");
    const data = JSON.parse(decoded) as {
      state: string;
      codeVerifier: string;
    };
    if (!data.state || !data.codeVerifier) return null;

    const url = new URL(request.url);
    const stateParam = url.searchParams.get("state");
    if (!stateParam || stateParam !== data.state) return null;

    return data;
  } catch {
    return null;
  }
}

const PROVIDER_FIELDS = {
  discord: {
    id: "discordId",
    name: "discordName",
    avatar: "discordAvatar",
  },
  github: { id: "githubId", name: "githubName", avatar: "githubAvatar" },
} as const;

export async function updateUserSocial(
  userId: string,
  provider: OAuthProvider,
  data: {
    providerId: string;
    name: string;
    avatar: string | null;
    email?: string | null;
  },
): Promise<void> {
  const fields = PROVIDER_FIELDS[provider];

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      displayName: true,
      avatar: true,
      email: true,
      onboardingStep: true,
    },
  });

  const updateData: Record<string, unknown> = {
    [fields.id]: data.providerId,
    [fields.name]: data.name,
    [fields.avatar]: data.avatar,
  };

  if (!user.displayName) {
    updateData.displayName = data.name;
  }
  if (!user.avatar && data.avatar) {
    updateData.avatar = data.avatar;
  }
  if (!user.email && data.email) {
    updateData.email = data.email;
  }
  if (user.onboardingStep < 1) {
    updateData.onboardingStep = 1;
  }

  await prisma.user.update({
    where: { id: userId },
    data: updateData,
  });
}

export async function disconnectSocial(
  userId: string,
  provider: OAuthProvider,
): Promise<void> {
  const fields = PROVIDER_FIELDS[provider];

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      displayName: true,
      avatar: true,
      discordName: true,
      discordAvatar: true,
      githubName: true,
      githubAvatar: true,
    },
  });

  const updateData: Record<string, unknown> = {
    [fields.id]: null,
    [fields.name]: null,
    [fields.avatar]: null,
  };

  const providerName = user[fields.name] as string | null;
  if (user.displayName && user.displayName === providerName) {
    updateData.displayName = null;
  }

  const providerAvatar = user[fields.avatar] as string | null;
  if (user.avatar && user.avatar === providerAvatar) {
    updateData.avatar = null;
  }

  await prisma.user.update({
    where: { id: userId },
    data: updateData,
  });
}

export function getRedirectBase(): string {
  return process.env.OAUTH_REDIRECT_BASE || "http://localhost:3000";
}

export function oauthPopupResponse(
  origin: string,
  provider: string,
  clearCookie: string,
): Response {
  const html = `<!DOCTYPE html><html><body><script>
if (window.opener) {
  window.opener.postMessage({ type: "oauth-success", provider: "${provider}" }, "${origin}");
  window.close();
} else {
  window.location.href = "/?onboarding=refresh";
}
</script><noscript><a href="/?onboarding=refresh">Click here to continue</a></noscript></body></html>`;
  const response = new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
  response.headers.append("Set-Cookie", clearCookie);
  return response;
}

export function oauthPopupErrorResponse(
  origin: string,
  provider: string,
  error: string,
  clearCookie: string,
): Response {
  const safeError = error.replace(/[^a-zA-Z0-9_-]/g, "");
  const html = `<!DOCTYPE html><html><body><script>
if (window.opener) {
  window.opener.postMessage({ type: "oauth-error", provider: "${provider}", error: "${safeError}" }, "${origin}");
  window.close();
} else {
  window.location.href = "/";
}
</script><noscript><a href="/">Click here to continue</a></noscript></body></html>`;
  const response = new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
  response.headers.append("Set-Cookie", clearCookie);
  return response;
}
