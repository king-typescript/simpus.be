import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";
import {
  getClientIp,
  hasOnlyFields,
  isJsonContentType,
  isRecord,
  isUuid,
  normalizeText,
  parseOptionalString,
} from "@/lib/validation";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}
function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}
function validBarcode(value: string) {
  return /^[A-Z0-9-]{3,100}$/.test(value);
}
function parseDate(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.getTime() > Date.now() ? undefined : date;
}

const select = {
  id: true, bookId: true, shelfId: true, barcode: true, status: true, isActive: true,
  conditionNote: true, acquiredAt: true, createdAt: true, updatedAt: true,
  book: { select: { id: true, isbn: true, title: true, isActive: true } },
  shelf: { select: { id: true, code: true, name: true, location: true } },
} as const;

const studentSelect = {
  id: true, bookId: true, status: true,
  book: { select: { id: true, isbn: true, title: true } },
  shelf: { select: { code: true, name: true, location: true } },
} as const;

export async function GET(_request: Request, context: Context) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return errorResponse("Autentikasi diperlukan.", 401);
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID salinan buku tidak valid.", 422);

  try {
    const data = await prisma.bookCopy.findFirst({
      where: {
        id,
        schoolId: auth.schoolId,
        isActive: true,
        book: { isActive: true, category: { is: { isActive: true } } },
      },
      select: auth.user.role === "PUSTAKAWAN" ? select : studentSelect,
    });
    return data ? NextResponse.json({ data }, { headers: noStoreHeaders }) : errorResponse("Salinan buku tidak ditemukan.", 404);
  } catch { return errorResponse("Terjadi kesalahan pada server.", 500); }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID salinan buku tidak valid.", 422);
  if (!isJsonContentType(request)) return errorResponse("Content-Type harus application/json.", 415);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("Body JSON tidak valid.", 400); }
  if (!isRecord(body) || !hasOnlyFields(body, ["shelfId", "barcode", "conditionNote", "acquiredAt"])) return errorResponse("Body request tidak valid.", 422);

  const data: { shelfId?: string | null; barcode?: string; conditionNote?: string | null; acquiredAt?: Date | null } = {};
  if ("shelfId" in body) {
    if (body.shelfId !== null && !isUuid(body.shelfId)) return errorResponse("Shelf ID tidak valid.", 422);
    data.shelfId = body.shelfId as string | null;
  }
  if ("barcode" in body) {
    if (typeof body.barcode !== "string") return errorResponse("Barcode tidak valid.", 422);
    const barcode = normalizeText(body.barcode).toUpperCase();
    if (!validBarcode(barcode)) return errorResponse("Barcode tidak valid.", 422);
    data.barcode = barcode;
  }
  if ("conditionNote" in body) {
    const result = parseOptionalString(body.conditionNote, { field: "Catatan kondisi", maxLength: 1000 });
    if (!result.ok) return errorResponse(result.error, 422);
    data.conditionNote = result.value ?? null;
  }
  if ("acquiredAt" in body) {
    const value = parseDate(body.acquiredAt);
    if (value === undefined) return errorResponse("Tanggal pengadaan tidak valid.", 422);
    data.acquiredAt = value;
  }
  if (!Object.keys(data).length) return errorResponse("Tidak ada perubahan.", 422);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.bookCopy.findFirst({ where: { id, schoolId: auth.schoolId, isActive: true }, select });
      if (!current) return null;
      if (current.status === "DIPINJAM") throw new Error("BORROWED_COPY_LOCKED");
      if (data.shelfId && !(await tx.shelf.findUnique({ where: { id: data.shelfId, schoolId: auth.schoolId }, select: { id: true } }))) throw new Error("SHELF_NOT_FOUND");
      const copy = await tx.bookCopy.update({ where: { id, schoolId: auth.schoolId }, data, select });
      await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "UPDATE", entityType: "BookCopy", entityId: id, oldData: jsonValue(current), newData: jsonValue(copy), ipAddress: getClientIp(request) } });
      return copy;
    }, { isolationLevel: "Serializable" });
    return updated ? NextResponse.json({ data: updated }, { headers: noStoreHeaders }) : errorResponse("Salinan buku tidak ditemukan.", 404);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "SHELF_NOT_FOUND") return errorResponse("Rak tidak ditemukan.", 422);
    if (error instanceof Error && error.message === "BORROWED_COPY_LOCKED") return errorResponse("Salinan yang sedang dipinjam tidak dapat diubah.", 409);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return errorResponse("Barcode sudah digunakan.", 409);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}

export async function DELETE(request: Request, context: Context) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID salinan buku tidak valid.", 422);

  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const current = await tx.bookCopy.findFirst({ where: { id, schoolId: auth.schoolId, isActive: true }, select });
      if (!current) return false;
      if (current.status === "DIPINJAM") throw new Error("BORROWED_COPY_CANNOT_DELETE");
      const copy = await tx.bookCopy.update({ where: { id, schoolId: auth.schoolId }, data: { isActive: false }, select });
      await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "DEACTIVATE", entityType: "BookCopy", entityId: id, oldData: jsonValue(current), newData: jsonValue(copy), ipAddress: getClientIp(request) } });
      return true;
    }, { isolationLevel: "Serializable" });
    return deleted ? new NextResponse(null, { status: 204 }) : errorResponse("Salinan buku tidak ditemukan.", 404);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "BORROWED_COPY_CANNOT_DELETE") return errorResponse("Salinan yang sedang dipinjam tidak dapat diarsipkan.", 409);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
