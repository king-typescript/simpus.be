import { NextResponse } from "next/server";
import argon2 from "argon2";
import { prisma } from "@/lib/prisma";
import {
  AUTH_COOKIE_NAME,
  authCookieOptions,
  createAuthToken,
  noStoreHeaders,
} from "@/lib/auth";

export const runtime = "nodejs";

const INVALID_CREDENTIALS = "Username atau password salah.";
const SERVER_ERROR = "Terjadi kesalahan pada server.";
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$WNXtRUBVPKJd0ntXbRHsaA$37u7VFDdU7kTjPe9/olF+O8r1vsnAnEXBBnExV2Dw4k";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders });
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("Body JSON tidak valid.", 400);
  }

  if (!isRecord(body)) {
    return errorResponse("Body request tidak valid.", 400);
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password || username.length > 100 || password.length > 256) {
    return errorResponse(INVALID_CREDENTIALS, 401);
  }

  try {
    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        name: true,
        role: true,
        status: true,
      },
    });

    const passwordMatches = await argon2.verify(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );

    if (!user || user.status !== "AKTIF" || !passwordMatches) {
      return errorResponse(INVALID_CREDENTIALS, 401);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = await createAuthToken({
      userId: user.id,
      role: user.role,
    });

    const response = NextResponse.json(
      {
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
        },
      },
      { headers: noStoreHeaders },
    );

    response.cookies.set(AUTH_COOKIE_NAME, token, authCookieOptions);
    return response;
  } catch {
    return errorResponse(SERVER_ERROR, 500);
  }
}
