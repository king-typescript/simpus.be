import { NextResponse } from "next/server";

import { noStoreHeaders, requireStudent } from "@/lib/auth";
import {
  assertEbookAccessToken,
  markEbookAccessUsed,
} from "@/lib/ebook-access";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders });
}

function accessErrorStatus(code: string) {
  if (code === "ACCESS_NOT_FOUND") return 404;
  if (code === "EBOOK_NOT_ACTIVE") return 409;
  if (code === "ACCESS_EXPIRED" || code === "ACCESS_NOT_ACTIVE") return 410;
  return 500;
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireStudent();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  const { id: accessId } = await context.params;
  if (!isUuid(accessId)) return errorResponse("ID akses tidak valid.", 422);

  try {
    const access = await assertEbookAccessToken(
      accessId,
      auth.student.id,
      auth.schoolId,
      request.headers.get("authorization"),
    );

    await markEbookAccessUsed(access.id, auth.student.id, auth.schoolId);

    return NextResponse.json({
      data: {
        accessId: access.id,
        ebookId: access.ebookId,
        viewerType: access.ebook.contentType === "application/pdf" ? "PDF" : "EPUB",
        fileUrl: `/api/ebook/akses/${access.id}/file`,
        expiresAt: access.expiresAt,
        watermark: {
          name: auth.student.name,
          nis: auth.student.nis,
        },
        ebook: {
          fileName: access.ebook.fileName,
          contentType: access.ebook.contentType,
          fileSize: access.ebook.fileSize.toString(),
          title: access.ebook.book.title,
        },
      },
    }, { headers: noStoreHeaders });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = typeof error.code === "string" ? error.code : "";
      return errorResponse(
        error instanceof Error ? error.message : "Akses e-book tidak valid.",
        accessErrorStatus(code),
      );
    }
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
