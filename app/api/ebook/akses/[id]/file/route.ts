import { NextResponse } from "next/server";

import { noStoreHeaders, requireStudent } from "@/lib/auth";
import {
  assertEbookAccessToken,
  markEbookAccessUsed,
} from "@/lib/ebook-access";
import { getEbookFile } from "@/lib/ebook-storage";
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

function safeFileName(value: string): string {
  return value
    .replace(/[\r\n"\\/]/g, "-")
    .trim()
    .slice(0, 180) || "ebook";
}

function getStorageStatus(error: unknown): number {
  if (
    typeof error === "object"
    && error !== null
    && "$metadata" in error
    && typeof error.$metadata === "object"
    && error.$metadata !== null
    && "httpStatusCode" in error.$metadata
    && error.$metadata.httpStatusCode === 404
  ) return 404;

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

    const range = request.headers.get("range");
    const object = await getEbookFile(access.ebook.fileKey, range);

    if (!object.Body) return errorResponse("File e-book tidak tersedia.", 404);

    const headers = new Headers(noStoreHeaders);
    headers.set("Content-Type", access.ebook.contentType);
    headers.set(
      "Content-Disposition",
      `inline; filename="${safeFileName(access.ebook.fileName)}"`,
    );
    headers.set("Cache-Control", "private, no-store");
    headers.set("Pragma", "no-cache");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Accept-Ranges", "bytes");

    if (object.ContentLength !== undefined) {
      headers.set("Content-Length", String(object.ContentLength));
    }
    if (object.ContentRange) headers.set("Content-Range", object.ContentRange);
    if (object.ETag) headers.set("ETag", object.ETag);

    const status = object.ContentRange ? 206 : 200;

    return new NextResponse(object.Body.transformToWebStream(), {
      status,
      headers,
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = typeof error.code === "string" ? error.code : "";
      return errorResponse(
        error instanceof Error ? error.message : "Akses e-book tidak valid.",
        accessErrorStatus(code),
      );
    }

    const status = getStorageStatus(error);
    return errorResponse(
      status === 404 ? "File e-book tidak ditemukan." : "Gagal membaca file e-book.",
      status,
    );
  }
}
