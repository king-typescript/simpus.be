import { NextResponse } from "next/server";

import { noStoreHeaders } from "@/lib/auth";
import { expireEbookAccesses } from "@/lib/ebook-access";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders });
}

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return errorResponse("Tidak memiliki akses.", 401);

  const now = new Date();

  try {
    const expired = await expireEbookAccesses(now);

    if (expired > 0) {
      await prisma.auditLog.create({
        data: {
          action: "UPDATE",
          entityType: "EbookAccess",
          newData: {
            action: "EXPIRE_BATCH",
            count: expired,
            expiredAt: now.toISOString(),
          },
        },
      });
    }

    return NextResponse.json({
      data: {
        expired,
        processedAt: now,
      },
    }, { headers: noStoreHeaders });
  } catch {
    return errorResponse("Gagal memperbarui akses e-book kedaluwarsa.", 500);
  }
}
