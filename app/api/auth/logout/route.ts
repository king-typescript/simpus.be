import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AUTH_COOKIE_NAME,
  clearAuthCookieOptions,
  noStoreHeaders,
  requireSchoolContext,
} from "@/lib/auth";
import { getClientIp } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireSchoolContext();

  if (auth.ok) {
    // ponytail: fire-and-forget audit for logout; acceptable to lose on crash
    prisma.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "LOGOUT", entityType: "User", entityId: auth.user.id, ipAddress: getClientIp(request) } }).catch(() => {});
  }

  const response = NextResponse.json(
    { message: "Logout berhasil." },
    { headers: noStoreHeaders },
  );

  response.cookies.set(AUTH_COOKIE_NAME, "", clearAuthCookieOptions);
  return response;
}
