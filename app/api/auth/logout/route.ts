import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  clearAuthCookieOptions,
  noStoreHeaders,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json(
    { message: "Logout berhasil." },
    { headers: noStoreHeaders },
  );

  response.cookies.set(AUTH_COOKIE_NAME, "", clearAuthCookieOptions);
  return response;
}
