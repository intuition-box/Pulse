import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/server/db/prisma";
import { getSessionFromRequest } from "@/server/auth/session";

const PROFILE_SELECT = {
  displayName: true,
  avatar: true,
  bio: true,
  email: true,
  onboardingStep: true,
  discordId: true,
  discordName: true,
  discordAvatar: true,
  githubId: true,
  githubName: true,
  githubAvatar: true,
} as const;

export async function GET(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: PROFILE_SELECT,
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    displayName: user.displayName,
    avatar: user.avatar,
    bio: user.bio,
    email: user.email,
    onboardingStep: user.onboardingStep,
    discord: user.discordId
      ? { name: user.discordName!, avatar: user.discordAvatar }
      : null,
    github: user.githubId
      ? { name: user.githubName!, avatar: user.githubAvatar }
      : null,
  });
}

const PatchSchema = z.object({
  displayName: z.string().min(2).max(30).optional(),
  avatar: z.string().url().nullable().optional(),
  bio: z.string().max(160).optional(),
  onboardingStep: z.number().int().min(0).max(1).optional(),
});

export async function PATCH(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = parsed.data;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.userId },
    data,
  });

  return NextResponse.json({ ok: true });
}
