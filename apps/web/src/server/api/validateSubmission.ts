import { NextResponse } from "next/server";

import { prisma } from "@/server/db/prisma";
import { requireSiweAuth } from "@/server/auth/siwe";
import { isRecord } from "@/lib/isRecord";
import { getErrorMessage } from "@/lib/getErrorMessage";

const allowedStances = new Set(["SUPPORTS", "REFUTES"]);
const MAX_PARENT_CONTEXT = 800;

export type ValidatedSubmission = {
  userId: string;
  themeSlug: string;
  trimmedInput: string;
  normalizedParentPostId: string | null;
  normalizedStance: "SUPPORTS" | "REFUTES" | null;
  theme: { slug: string; name: string | null };
  parentBody: string | null;
};

type ValidationResult =
  | { ok: true; data: ValidatedSubmission }
  | { ok: false; response: NextResponse };

export async function validateSubmissionRequest(
  request: Request,
  opts?: { includeParentBody?: boolean },
): Promise<ValidationResult> {
  // 1. Auth
  let auth: { userId: string };
  try {
    auth = await requireSiweAuth(request);
  } catch (error: unknown) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: getErrorMessage(error, "Unauthorized.") },
        { status: 401 },
      ),
    };
  }

  // 2. JSON body
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 }),
    };
  }

  const userId = auth.userId;
  const { themeSlug, inputText, parentPostId, stance } = body as Record<string, unknown>;

  // 3. themeSlug
  if (typeof themeSlug !== "string" || !themeSlug.trim()) {
    return {
      ok: false,
      response: NextResponse.json({ error: "themeSlug is required." }, { status: 400 }),
    };
  }

  // 4. inputText
  const trimmedInput = typeof inputText === "string" ? inputText.trim() : "";
  if (!trimmedInput) {
    return {
      ok: false,
      response: NextResponse.json({ error: "inputText is required." }, { status: 400 }),
    };
  }
  if (trimmedInput.length > 5000) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Input too long (max 5000 characters)." }, { status: 400 }),
    };
  }

  // 5. User exists
  const user = await prisma.user.findUnique({ where: { id: userId.trim() } });
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "User not found." }, { status: 404 }),
    };
  }

  // 6. Theme exists
  const theme = await prisma.theme.findUnique({ where: { slug: themeSlug } });
  if (!theme) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Theme not found." }, { status: 404 }),
    };
  }

  // 7. parentPostId + stance
  let normalizedParentPostId: string | null = null;
  let normalizedStance: "SUPPORTS" | "REFUTES" | null = null;
  let parentBody: string | null = null;

  if (typeof parentPostId === "string" && parentPostId.trim()) {
    normalizedParentPostId = parentPostId.trim();
  } else if (parentPostId != null) {
    return {
      ok: false,
      response: NextResponse.json({ error: "parentPostId must be a string." }, { status: 400 }),
    };
  }

  if (normalizedParentPostId) {
    if (typeof stance !== "string" || !allowedStances.has(stance)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "stance is required when parentPostId is provided (SUPPORTS or REFUTES)." },
          { status: 400 },
        ),
      };
    }
    normalizedStance = stance as "SUPPORTS" | "REFUTES";

    const parent = await prisma.post.findUnique({
      where: { id: normalizedParentPostId },
      select: { body: true },
    });
    if (!parent) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Parent post not found." }, { status: 404 }),
      };
    }

    if (opts?.includeParentBody) {
      const rawBody = (parent.body ?? "").replace(/\s+/g, " ").trim();
      parentBody = rawBody.length > MAX_PARENT_CONTEXT
        ? rawBody.slice(0, MAX_PARENT_CONTEXT) + "..."
        : rawBody;
    }
  } else if (stance != null) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "stance is only allowed when parentPostId is provided." },
        { status: 400 },
      ),
    };
  }

  return {
    ok: true,
    data: {
      userId: user.id,
      themeSlug: theme.slug,
      trimmedInput,
      normalizedParentPostId,
      normalizedStance,
      theme: { slug: theme.slug, name: theme.name ?? null },
      parentBody,
    },
  };
}
