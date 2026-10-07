import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { prisma } from "@/lib/prisma";

export const AUTH_COOKIE_NAME = "simpli_auth";
const SESSION_TTL_SECONDS = 60 * 60 * 24;
const AUTH_ISSUER = "simpus-satak";
const AUTH_AUDIENCE = "simpus-satak-api";

const validRoles = new Set(["PUSTAKAWAN", "SISWA"] as const);

type UserRole = "PUSTAKAWAN" | "SISWA";

export type AuthTokenPayload = JWTPayload & {
  userId: string;
  role: UserRole;
};

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;

  if (!secret || new TextEncoder().encode(secret).length < 32) {
    throw new Error("AUTH_SECRET harus diatur dan minimal 32 byte.");
  }

  return new TextEncoder().encode(secret);
}

export async function createAuthToken(
  payload: Omit<AuthTokenPayload, "iat" | "exp" | "iss" | "aud" | "jti">,
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(AUTH_ISSUER)
    .setAudience(AUTH_AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getAuthSecret());
}

export async function verifyAuthToken(token: string) {
  const { payload } = await jwtVerify<AuthTokenPayload>(token, getAuthSecret(), {
    algorithms: ["HS256"],
    issuer: AUTH_ISSUER,
    audience: AUTH_AUDIENCE,
  });

  if (
    typeof payload.userId !== "string" ||
    !payload.userId ||
    typeof payload.role !== "string" ||
    !validRoles.has(payload.role as UserRole)
  ) {
    throw new Error("Token auth tidak valid.");
  }

  return payload;
}

export async function requireAuthenticatedUser() {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;

  if (!token) return { ok: false as const, status: 401 as const };

  try {
    const payload = await verifyAuthToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true, name: true, role: true, status: true },
    });

    if (!user || user.status !== "AKTIF") {
      return { ok: false as const, status: 401 as const };
    }

    return { ok: true as const, user };
  } catch {
    return { ok: false as const, status: 401 as const };
  }
}

export async function requireStudent() {
  const auth = await requireAuthenticatedUser();

  if (!auth.ok) return auth;
  if (auth.user.role !== "SISWA") {
    return { ok: false as const, status: 403 as const };
  }

  const student = await prisma.student.findFirst({
    where: {
      userId: auth.user.id,
      isActive: true,
    },
    select: {
      id: true,
      userId: true,
      nis: true,
      name: true,
      className: true,
      libraryCardNumber: true,
      isActive: true,
    },
  });

  if (!student) return { ok: false as const, status: 403 as const };

  return {
    ok: true as const,
    user: auth.user,
    student,
  };
}

export async function requireLibrarian() {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    return { ok: false as const, status: 401 as const };
  }

  try {
    const payload = await verifyAuthToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, role: true, status: true },
    });

    if (!user || user.status !== "AKTIF") {
      return { ok: false as const, status: 401 as const };
    }

    if (user.role !== "PUSTAKAWAN") {
      return { ok: false as const, status: 403 as const };
    }

    return { ok: true as const, user };
  } catch {
    return { ok: false as const, status: 401 as const };
  }
}

export const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};

export const clearAuthCookieOptions = {
  ...authCookieOptions,
  maxAge: 0,
};

export const noStoreHeaders = {
  "Cache-Control": "no-store",
};
