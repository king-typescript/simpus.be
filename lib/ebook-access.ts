import "server-only";

import { prisma } from "@/lib/prisma";
import {
  extractBearerToken,
  hashEbookAccessToken,
} from "@/lib/ebook-token";

export const EBOOK_DEFAULT_DURATION_DAYS = 7;
export const EBOOK_MAX_EXTENSIONS = 2;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export type EbookAccessErrorCode =
  | "ACCESS_NOT_FOUND"
  | "ACCESS_NOT_ACTIVE"
  | "ACCESS_EXPIRED"
  | "EBOOK_NOT_ACTIVE"
  | "EXTENSION_LIMIT_REACHED"
  | "CONCURRENT_UPDATE";

export class EbookAccessError extends Error {
  constructor(
    public readonly code: EbookAccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EbookAccessError";
  }
}

export function addEbookDuration(
  date: Date,
  days = EBOOK_DEFAULT_DURATION_DAYS,
): Date {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("Durasi e-book tidak valid.");
  }

  return new Date(date.getTime() + days * MILLISECONDS_PER_DAY);
}

export function isEbookAccessExpired(
  expiresAt: Date,
  now = new Date(),
): boolean {
  return expiresAt.getTime() <= now.getTime();
}

const ebookAccessSelect = {
  id: true,
  ebookId: true,
  studentId: true,
  startedAt: true,
  expiresAt: true,
  returnedAt: true,
  lastAccessedAt: true,
  extensionCount: true,
  status: true,
  ebook: {
    select: {
      id: true,
      bookId: true,
      fileKey: true,
      fileName: true,
      contentType: true,
      fileSize: true,
      status: true,
      book: {
        select: {
          id: true,
          title: true,
          isActive: true,
        },
      },
    },
  },
} as const;

export async function getEbookAccessForStudent(
  accessId: string,
  studentId: string,
  schoolId: string,
) {
  const access = await prisma.ebookAccess.findFirst({
    where: { id: accessId, studentId, schoolId },
    select: ebookAccessSelect,
  });

  if (!access) {
    throw new EbookAccessError(
      "ACCESS_NOT_FOUND",
      "Akses e-book tidak ditemukan.",
    );
  }

  return access;
}

export async function assertActiveEbookAccess(
  accessId: string,
  studentId: string,
  schoolId: string,
  now = new Date(),
) {
  const access = await getEbookAccessForStudent(accessId, studentId, schoolId);

  if (access.ebook.status !== "AKTIF" || !access.ebook.book.isActive) {
    throw new EbookAccessError("EBOOK_NOT_ACTIVE", "E-book tidak aktif.");
  }

  if (access.status !== "AKTIF") {
    throw new EbookAccessError(
      "ACCESS_NOT_ACTIVE",
      "Akses e-book sudah tidak aktif.",
    );
  }

  if (isEbookAccessExpired(access.expiresAt, now)) {
    await prisma.ebookAccess.updateMany({
      where: { id: access.id, studentId, status: "AKTIF" },
      data: { status: "KEDALUWARSA" },
    });

    throw new EbookAccessError(
      "ACCESS_EXPIRED",
      "Masa akses e-book sudah berakhir.",
    );
  }

  return access;
}

export async function assertEbookAccessToken(
  accessId: string,
  studentId: string,
  schoolId: string,
  authorizationHeader: string | null,
) {
  const token = extractBearerToken(authorizationHeader);

  if (!token) {
    throw new EbookAccessError(
      "ACCESS_NOT_FOUND",
      "Token akses e-book tidak valid.",
    );
  }

  const access = await prisma.ebookAccess.findFirst({
    where: {
      id: accessId,
      studentId,
      accessTokenHash: hashEbookAccessToken(token),
    },
    select: { id: true },
  });

  if (!access) {
    throw new EbookAccessError(
      "ACCESS_NOT_FOUND",
      "Token akses e-book tidak valid.",
    );
  }

  return assertActiveEbookAccess(access.id, studentId, schoolId);
}

export async function markEbookAccessUsed(
  accessId: string,
  studentId: string,
  schoolId: string,
  now = new Date(),
): Promise<void> {
  await prisma.ebookAccess.updateMany({
    where: {
      id: accessId,
      studentId,
      status: "AKTIF",
      expiresAt: { gt: now },
      ebook: {
        status: "AKTIF",
        book: { isActive: true },
      },
    },
    data: { lastAccessedAt: now },
  });
}

type EbookAuditOptions = {
  userId?: string;
  ipAddress?: string | null;
};

function auditValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

export async function returnEbookAccess(
  accessId: string,
  studentId: string,
  schoolId: string,
  now = new Date(),
  audit?: EbookAuditOptions,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.ebookAccess.findFirst({
      where: { id: accessId, studentId, schoolId },
      select: { status: true, expiresAt: true },
    });

    if (!current) {
      throw new EbookAccessError("ACCESS_NOT_FOUND", "Akses e-book tidak ditemukan.");
    }

    if (current.status !== "AKTIF") {
      throw new EbookAccessError("ACCESS_NOT_ACTIVE", "Akses e-book sudah tidak aktif.");
    }

    if (isEbookAccessExpired(current.expiresAt, now)) {
      await tx.ebookAccess.updateMany({
        where: { id: accessId, studentId, schoolId, status: "AKTIF" },
        data: { status: "KEDALUWARSA" },
      });
      throw new EbookAccessError("ACCESS_EXPIRED", "Masa akses e-book sudah berakhir.");
    }

    const result = await tx.ebookAccess.updateMany({
      where: { id: accessId, studentId, schoolId, status: "AKTIF", expiresAt: { gt: now } },
      data: { status: "DIKEMBALIKAN", returnedAt: now },
    });

    if (result.count !== 1) {
      throw new EbookAccessError("ACCESS_NOT_ACTIVE", "Akses e-book sudah tidak aktif.");
    }

    const returned = await tx.ebookAccess.findUniqueOrThrow({
      where: { id: accessId, schoolId },
      select: {
        id: true,
        ebookId: true,
        studentId: true,
        startedAt: true,
        expiresAt: true,
        returnedAt: true,
        extensionCount: true,
        status: true,
      },
    });

    if (audit?.userId) {
      await tx.auditLog.create({
        data: {
          userId: audit.userId,
          action: "UPDATE",
          entityType: "EbookAccess",
          entityId: returned.id,
          newData: auditValue({
            action: "RETURN",
            accessId: returned.id,
            ebookId: returned.ebookId,
            studentId: returned.studentId,
            returnedAt: returned.returnedAt,
            status: returned.status,
          }),
          ipAddress: audit.ipAddress ?? null,
        },
      });
    }

    return returned;
  });
}

async function extendEbookAccessOnce(
  accessId: string,
  studentId: string,
  schoolId: string,
  now: Date,
  audit?: EbookAuditOptions,
) {
  return prisma.$transaction(
    async (tx) => {
      const access = await tx.ebookAccess.findFirst({
        where: { id: accessId, studentId, schoolId },
        select: {
          id: true,
          expiresAt: true,
          extensionCount: true,
          status: true,
          ebook: {
            select: {
              status: true,
              book: { select: { isActive: true } },
            },
          },
        },
      });

      if (!access) {
        throw new EbookAccessError(
          "ACCESS_NOT_FOUND",
          "Akses e-book tidak ditemukan.",
        );
      }

      if (access.ebook.status !== "AKTIF" || !access.ebook.book.isActive) {
        throw new EbookAccessError("EBOOK_NOT_ACTIVE", "E-book tidak aktif.");
      }

      if (access.status !== "AKTIF") {
        throw new EbookAccessError(
          "ACCESS_NOT_ACTIVE",
          "Akses e-book sudah tidak aktif.",
        );
      }

      if (isEbookAccessExpired(access.expiresAt, now)) {
        await tx.ebookAccess.updateMany({
          where: { id: access.id, schoolId, status: "AKTIF" },
          data: { status: "KEDALUWARSA" },
        });

        throw new EbookAccessError(
          "ACCESS_EXPIRED",
          "Masa akses e-book sudah berakhir.",
        );
      }

      if (access.extensionCount >= EBOOK_MAX_EXTENSIONS) {
        throw new EbookAccessError(
          "EXTENSION_LIMIT_REACHED",
          "Batas perpanjangan e-book sudah tercapai.",
        );
      }

      const updated = await tx.ebookAccess.updateMany({
        where: {
          id: access.id,
          studentId,
          status: "AKTIF",
          extensionCount: access.extensionCount,
          expiresAt: access.expiresAt,
        },
        data: {
          expiresAt: addEbookDuration(access.expiresAt),
          extensionCount: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        throw new EbookAccessError(
          "CONCURRENT_UPDATE",
          "Akses e-book berubah. Coba lagi.",
        );
      }

      const updatedAccess = await tx.ebookAccess.findUniqueOrThrow({
        where: { id: access.id },
        select: {
          id: true,
          ebookId: true,
          studentId: true,
          startedAt: true,
          expiresAt: true,
          returnedAt: true,
          extensionCount: true,
          status: true,
        },
      });

      if (audit?.userId) {
        await tx.auditLog.create({
          data: {
            userId: audit.userId,
            action: "UPDATE",
            entityType: "EbookAccess",
            entityId: updatedAccess.id,
            newData: auditValue({
              action: "EXTEND",
              accessId: updatedAccess.id,
              ebookId: updatedAccess.ebookId,
              studentId: updatedAccess.studentId,
              expiresAt: updatedAccess.expiresAt,
              extensionCount: updatedAccess.extensionCount,
            }),
            ipAddress: audit.ipAddress ?? null,
          },
        });
      }

      return updatedAccess;
    },
    { isolationLevel: "Serializable" },
  );
}

export async function extendEbookAccess(
  accessId: string,
  studentId: string,
  schoolId: string,
  now = new Date(),
  audit?: EbookAuditOptions,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await extendEbookAccessOnce(accessId, studentId, schoolId, now, audit);
    } catch (error) {
      const conflict = typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "P2034";
      if (!conflict || attempt === 2) throw error;
    }
  }

  throw new EbookAccessError("CONCURRENT_UPDATE", "Akses e-book berubah. Coba lagi.");
}

export async function expireEbookAccesses
(now = new Date()): Promise<number> {
  const result = await prisma.ebookAccess.updateMany({
    where: { status: "AKTIF", expiresAt: { lte: now } },
    data: { status: "KEDALUWARSA" },
  });

  return result.count;
}
