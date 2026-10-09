import { NextResponse } from "next/server";

import { noStoreHeaders, requireStudent } from "@/lib/auth";
import {
  addEbookDuration,
  EBOOK_DEFAULT_DURATION_DAYS,
} from "@/lib/ebook-access";
import { createEbookAccessToken } from "@/lib/ebook-token";
import { getClientIp, isUuid } from "@/lib/validation";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders });
}

function codeOf(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" ? error.code : null;
}

async function serializable<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (codeOf(error) !== "P2034" || attempt === 2) throw error;
    }
  }
  throw new Error("TRANSACTION_CONFLICT");
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireStudent();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  const { id: ebookId } = await context.params;
  if (!isUuid(ebookId)) return errorResponse("ID e-book tidak valid.", 422);

  const { token, tokenHash } = createEbookAccessToken();
  const startedAt = new Date();
  const expiresAt = addEbookDuration(startedAt, EBOOK_DEFAULT_DURATION_DAYS);

  try {
    const created = await serializable(() => prisma.$transaction(async (tx) => {
      const ebook = await tx.ebook.findFirst({
        where: { id: ebookId, schoolId: auth.schoolId, status: "AKTIF", book: { isActive: true } },
        select: {
          id: true,
          fileName: true,
          contentType: true,
          fileSize: true,
          book: { select: { id: true, title: true } },
        },
      });
      if (!ebook) throw new Error("EBOOK_NOT_AVAILABLE");

      const existing = await tx.ebookAccess.findFirst({
        where: {
          schoolId: auth.schoolId,
          ebookId,
          studentId: auth.student.id,
          status: "AKTIF",
          expiresAt: { gt: startedAt },
        },
        select: { id: true },
      });
      if (existing) throw new Error("ACCESS_ALREADY_EXISTS");

      const access = await tx.ebookAccess.create({
        data: {
          schoolId: auth.schoolId,
          ebookId,
          studentId: auth.student.id,
          accessTokenHash: tokenHash,
          startedAt,
          expiresAt,
          status: "AKTIF",
        },
        select: {
          id: true,
          ebookId: true,
          startedAt: true,
          expiresAt: true,
          extensionCount: true,
          status: true,
          ebook: {
            select: {
              fileName: true,
              contentType: true,
              fileSize: true,
              book: { select: { id: true, title: true } },
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          schoolId: auth.schoolId,
          userId: auth.user.id,
          action: "CREATE",
          entityType: "EbookAccess",
          entityId: access.id,
          newData: {
            ebookId,
            studentId: auth.student.id,
            startedAt: startedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
          },
          ipAddress: getClientIp(request),
        },
      });

      return access;
    }, { isolationLevel: "Serializable" }));

    return NextResponse.json({
      data: {
        accessId: created.id,
        ebookId: created.ebookId,
        accessToken: token,
        startedAt: created.startedAt,
        expiresAt: created.expiresAt,
        extensionCount: created.extensionCount,
        status: created.status,
        ebook: {
          ...created.ebook,
          fileSize: created.ebook.fileSize.toString(),
        },
      },
    }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    const code = codeOf(error);
    if (error instanceof Error && error.message === "EBOOK_NOT_AVAILABLE") {
      return errorResponse("E-book tidak tersedia.", 404);
    }
    if (error instanceof Error && error.message === "ACCESS_ALREADY_EXISTS") {
      return errorResponse("Anda masih memiliki akses aktif ke e-book ini.", 409);
    }
    if (code === "P2002") {
      return errorResponse("Anda masih memiliki akses aktif ke e-book ini.", 409);
    }
    if (code === "P2034") {
      return errorResponse("Permintaan bersamaan. Coba lagi.", 409);
    }
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
