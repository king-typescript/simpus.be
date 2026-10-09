import { NextResponse } from "next/server";
import argon2 from "argon2";
import { prisma } from "@/lib/prisma";
import {
  AUTH_COOKIE_NAME,
  authCookieOptions,
  createAuthToken,
  noStoreHeaders,
} from "@/lib/auth";
import { getClientIp, isJsonContentType, isRecord } from "@/lib/validation";
import { isRateLimited, recordAccountFailure } from "@/lib/rate-limit";

export const runtime = "nodejs";

const INVALID_CREDENTIALS = "Username atau password salah.";
const SERVER_ERROR = "Terjadi kesalahan pada server.";
const TOO_MANY_ATTEMPTS = "Terlalu banyak percobaan login. Coba lagi nanti.";
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$WNXtRUBVPKJd0ntXbRHsaA$37u7VFDdU7kTjPe9/olF+O8r1vsnAnEXBBnExV2Dw4k";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders });
}

export async function POST(request: Request) {
  if (!isJsonContentType(request)) {
    return errorResponse("Content-Type harus application/json.", 415);
  }
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("Body JSON tidak valid.", 400);
  }

  if (!isRecord(body)) {
    return errorResponse("Body request tidak valid.", 400);
  }

  const schoolCode = typeof body.schoolCode === "string" ? body.schoolCode.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!schoolCode || !username || !password || schoolCode.length > 100 || username.length > 100 || password.length > 256) {
    return errorResponse(INVALID_CREDENTIALS, 401);
  }

  const ip = getClientIp(request);
  const rateLimitIdentity = `${schoolCode}:${username.toLowerCase()}`;

  if (await isRateLimited([rateLimitIdentity, ip])) {
    return errorResponse(TOO_MANY_ATTEMPTS, 429);
  }

  try {
    const school = await prisma.school.findUnique({
      where: { code: schoolCode },
      select: { id: true, code: true, name: true, isActive: true },
    });
    const user = school
      ? await prisma.user.findUnique({
          where: { schoolId_username: { schoolId: school.id, username } },
          select: {
            id: true,
            schoolId: true,
            username: true,
            passwordHash: true,
            name: true,
            role: true,
            status: true,
            mustChangePassword: true,
          },
        })
      : null;

    const passwordMatches = await argon2.verify(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );

    if (!school || !school.isActive || !user || user.status !== "AKTIF" || !passwordMatches) {
      // ponytail: fire-and-forget audit for failed login; acceptable to lose on crash
      prisma.auditLog.create({ data: { schoolId: school?.id ?? null, userId: user?.id ?? null, action: "LOGIN_FAILED", entityType: "User", entityId: user?.id ?? null, newData: { schoolCode, username }, ipAddress: ip } }).catch(() => {});
      await recordAccountFailure(rateLimitIdentity, ip);
      return errorResponse(INVALID_CREDENTIALS, 401);
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
      prisma.auditLog.create({
        data: { schoolId: user.schoolId, userId: user.id, action: "LOGIN_SUCCESS", entityType: "User", entityId: user.id, ipAddress: ip },
      }),
    ]);

    const token = await createAuthToken({
      userId: user.id,
      schoolId: user.schoolId,
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
        school,
      },
      { headers: noStoreHeaders },
    );

    response.cookies.set(AUTH_COOKIE_NAME, token, authCookieOptions);
    return response;
  } catch {
    return errorResponse(SERVER_ERROR, 500);
  }
}
