import { NextResponse } from "next/server";

import { noStoreHeaders, requireStudent } from "@/lib/auth";
import { EbookAccessError, returnEbookAccess } from "@/lib/ebook-access";
import { getClientIp, isUuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders });
}

function statusFor(error: EbookAccessError) {
  if (error.code === "ACCESS_NOT_FOUND") return 404;
  if (error.code === "ACCESS_EXPIRED" || error.code === "ACCESS_NOT_ACTIVE") return 409;
  return 500;
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireStudent();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID akses tidak valid.", 422);

  try {
    const access = await returnEbookAccess(id, auth.student.id, auth.schoolId, new Date(), {
      userId: auth.user.id,
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({
      data: {
        id: access.id,
        ebookId: access.ebookId,
        startedAt: access.startedAt,
        expiresAt: access.expiresAt,
        returnedAt: access.returnedAt,
        extensionCount: access.extensionCount,
        status: access.status,
      },
    }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof EbookAccessError) {
      return errorResponse(error.message, statusFor(error));
    }
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
