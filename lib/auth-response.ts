import { NextResponse } from "next/server";

import { noStoreHeaders } from "@/lib/auth";

export function authErrorResponse(message: string, status: number, code?: string) {
  return NextResponse.json(
    { error: message, ...(code ? { code } : {}) },
    { status, headers: noStoreHeaders },
  );
}
