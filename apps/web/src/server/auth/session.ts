import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// ─── Config ──────────────────────────────────────────────────────────────────

const COOKIE_NAME = "dm_session";
const SESSION_MAX_AGE_S = 2 * 60 * 60;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET env var is required in production (min 32 chars).");
  }
  // Dev fallback — deterministic so sessions survive server restarts
  return "dev-session-secret-debate-market-32chars!!";
}

// ─── Token helpers (HMAC-SHA256, no external dependency) ─────────────────────

type SessionPayload = {
  sub: string;   // userId
  addr: string;  // wallet address (lowercase)
  chain: number; // chainId
  iat: number;   // issued at (epoch seconds)
  exp: number;   // expiration (epoch seconds)
};

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(payload: SessionPayload): string {
  const data = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const mac = createHmac("sha256", getSecret()).update(data).digest();
  return `${data}.${base64url(mac)}`;
}

function verify(token: string): SessionPayload | null {
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return null;

  const data = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);

  const expectedBuf = createHmac("sha256", getSecret()).update(data).digest();
  const sigBuf = Buffer.from(sig, "base64url");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp <= Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export type SessionData = {
  userId: string;
  address: string;
  chainId: number;
};

/**
 * Create a session token and return Set-Cookie header value.
 */
export function createSessionCookie(userId: string, address: string, chainId: number): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: userId,
    addr: address.toLowerCase(),
    chain: chainId,
    iat: now,
    exp: now + SESSION_MAX_AGE_S,
  };
  const token = sign(payload);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=${SESSION_MAX_AGE_S}`;
}

/**
 * Read and verify the session from a Request's cookies.
 * Returns null if no valid session exists.
 */
export function getSessionFromRequest(request: Request): SessionData | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;

  const payload = verify(match[1]);
  if (!payload) return null;

  return {
    userId: payload.sub,
    address: payload.addr,
    chainId: payload.chain,
  };
}

/**
 * Return a Set-Cookie header value that clears the session.
 */
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * Generate a nonce for SIWE message (used by the auth endpoint).
 */
export function generateNonce(): string {
  return randomBytes(16).toString("hex");
}
