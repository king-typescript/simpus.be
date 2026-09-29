import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { error: "Perpanjangan dilakukan offline melalui pustakawan." },
    { status: 501, headers: noStoreHeaders },
  );
}
