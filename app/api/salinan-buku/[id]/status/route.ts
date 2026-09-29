import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireLibrarian } from "@/lib/auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
type AdministrativeStatus = "TERSEDIA" | "RUSAK" | "HILANG";

const allowedTransitions: Record<AdministrativeStatus | "DIPINJAM", readonly AdministrativeStatus[]> = {
  TERSEDIA: ["RUSAK", "HILANG"],
  RUSAK: ["TERSEDIA"],
  HILANG: ["TERSEDIA"],
  DIPINJAM: [],
};

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isAdministrativeStatus(value: unknown): value is AdministrativeStatus {
  return value === "TERSEDIA" || value === "RUSAK" || value === "HILANG";
}
function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

const copySelect = {
  id: true,
  bookId: true,
  shelfId: true,
  barcode: true,
  status: true,
  isActive: true,
  conditionNote: true,
  acquiredAt: true,
  createdAt: true,
  updatedAt: true,
  book: { select: { id: true, isbn: true, title: true } },
  shelf: { select: { id: true, code: true, name: true, location: true } },
} as const;

async function runSerializable<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "P2034" ||
        attempt === 2
      ) {
        throw error;
      }
    }
  }

  throw new Error("TRANSACTION_CONFLICT");
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID salinan buku tidak valid.", 422);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Body JSON tidak valid.", 400);
  }

  if (!isRecord(body) || Object.keys(body).some((key) => !["status", "conditionNote"].includes(key))) {
    return errorResponse("Body request tidak valid.", 422);
  }

  const requestedStatus = body.status;
  if (!isAdministrativeStatus(requestedStatus)) {
    return errorResponse("Status administratif tidak valid.", 422);
  }

  let conditionNote: string | null | undefined;
  if (body.conditionNote === undefined) {
    conditionNote = undefined;
  } else if (body.conditionNote === null) {
    conditionNote = null;
  } else if (typeof body.conditionNote === "string") {
    conditionNote = body.conditionNote.trim() || null;
  } else {
    return errorResponse("Catatan kondisi tidak valid.", 422);
  }

  if (conditionNote !== undefined && conditionNote !== null && conditionNote.length > 1000) {
    return errorResponse("Catatan kondisi terlalu panjang.", 422);
  }

  try {
    const updated = await runSerializable(() => prisma.$transaction(async (tx) => {
      const current = await tx.bookCopy.findFirst({
        where: {
          id,
          isActive: true,
          book: { isActive: true, category: { is: { isActive: true } } },
        },
        select: copySelect,
      });

      if (!current) return null;
      if (current.status === "DIPINJAM") throw new Error("BORROWED_COPY_LOCKED");
      if (current.status === requestedStatus) throw new Error("STATUS_UNCHANGED");

      const transitions = allowedTransitions[current.status as keyof typeof allowedTransitions];
      if (!transitions.includes(requestedStatus)) throw new Error("INVALID_STATUS_TRANSITION");

      if ((requestedStatus === "RUSAK" || requestedStatus === "HILANG") && !conditionNote) {
        throw new Error("CONDITION_NOTE_REQUIRED");
      }

      if (requestedStatus === "TERSEDIA") {
        const activeLoan = await tx.loanItem.findFirst({
          where: {
            copyId: id,
            returnedAt: null,
            loan: { status: { in: ["AKTIF", "SEBAGIAN_DIKEMBALIKAN"] } },
          },
          select: { id: true },
        });
        if (activeLoan) throw new Error("ACTIVE_LOAN_EXISTS");
      }

      const updatedCopy = await tx.bookCopy.update({
        where: { id },
        data: {
          status: requestedStatus,
          ...(conditionNote !== undefined ? { conditionNote } : {}),
        },
        select: copySelect,
      });

      await tx.auditLog.create({
        data: {
          userId: auth.user.id,
          action: "CHANGE_STATUS",
          entityType: "BookCopy",
          entityId: id,
          oldData: jsonValue(current),
          newData: jsonValue(updatedCopy),
        },
      });

      return updatedCopy;
    }, { isolationLevel: "Serializable" }));

    if (!updated) return errorResponse("Salinan buku tidak ditemukan.", 404);
    return NextResponse.json({ data: updated }, { headers: noStoreHeaders });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "BORROWED_COPY_LOCKED") return errorResponse("Salinan sedang dipinjam. Gunakan proses pengembalian.", 409);
    if (error instanceof Error && error.message === "STATUS_UNCHANGED") return errorResponse("Status salinan tidak berubah.", 422);
    if (error instanceof Error && error.message === "INVALID_STATUS_TRANSITION") return errorResponse("Transisi status tidak diizinkan.", 422);
    if (error instanceof Error && error.message === "CONDITION_NOTE_REQUIRED") return errorResponse("Catatan kondisi wajib untuk status RUSAK atau HILANG.", 422);
    if (error instanceof Error && error.message === "ACTIVE_LOAN_EXISTS") return errorResponse("Salinan masih memiliki peminjaman aktif.", 409);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
