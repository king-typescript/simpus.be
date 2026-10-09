import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";
import {
  getClientIp,
  hasOnlyFields,
  isJsonContentType,
  isRecord,
  isUuid,
  parseEnum,
  parsePagination,
  parseSearch,
  parseOptionalString,
} from "@/lib/validation";

export const runtime = "nodejs";
const statuses = ["TERSEDIA", "DIPINJAM", "RUSAK", "HILANG"] as const;


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
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.getTime() > Date.now() ? undefined : date;
}

const librarianSelect = {
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

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return errorResponse("Autentikasi diperlukan.", 401);
  const url = new URL(request.url);
  const pagination = parsePagination(url.searchParams);
  if (!pagination.ok) return errorResponse(pagination.error, 422);
  const searchResult = parseSearch(url.searchParams);
  if (!searchResult.ok) return errorResponse(searchResult.error, 422);
  const { page, limit } = pagination.value;
  const bookId = url.searchParams.get("bookId")?.trim() ?? "";
  const shelfId = url.searchParams.get("shelfId")?.trim() ?? "";
  const search = searchResult.value;
  const status = url.searchParams.get("status")?.trim() ?? "";
  const statusResult = status ? parseEnum(status, statuses, "Status salinan buku") : null;

  if ((bookId && !isUuid(bookId)) || (shelfId && !isUuid(shelfId))) return errorResponse("ID filter tidak valid.", 422);
  if (statusResult && !statusResult.ok) return errorResponse(statusResult.error, 422);

  const where = {
    schoolId: auth.schoolId,
    isActive: true,
    book: { isActive: true, category: { is: { isActive: true } } },
    ...(bookId ? { bookId } : {}),
    ...(shelfId ? { shelfId } : {}),
    ...(statusResult?.ok ? { status: statusResult.value } : {}),
    ...(search ? { OR: [
      { barcode: { contains: search, mode: "insensitive" as const } },
      { book: { title: { contains: search, mode: "insensitive" as const } } },
      { book: { isbn: { contains: search, mode: "insensitive" as const } } },
    ] } : {}),
  };

  try {
    const select = auth.user.role === "PUSTAKAWAN" ? librarianSelect : studentSelect;
    const [data, total] = await prisma.$transaction([
      prisma.bookCopy.findMany({ where, select, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit }),
      prisma.bookCopy.count({ where }),
    ]);
    return NextResponse.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }, { headers: noStoreHeaders });
  } catch { return errorResponse("Terjadi kesalahan pada server.", 500); }
}

export async function POST(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  if (!isJsonContentType(request)) return errorResponse("Content-Type harus application/json.", 415);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("Body JSON tidak valid.", 400); }
  if (!isRecord(body) || !hasOnlyFields(body, ["bookId", "shelfId", "barcode", "conditionNote", "acquiredAt"])) return errorResponse("Body request tidak valid.", 422);

  const bookId = body.bookId;
  const shelfId = body.shelfId === null || body.shelfId === undefined ? null : body.shelfId;
  const barcode = typeof body.barcode === "string" ? body.barcode.trim().toUpperCase() : "";
  const noteResult = parseOptionalString(body.conditionNote, { field: "Catatan kondisi", maxLength: 1000 });
  const acquiredAt = parseDate(body.acquiredAt);

  if (!isUuid(bookId) || (shelfId !== null && !isUuid(shelfId)) || !validBarcode(barcode) || !noteResult.ok || acquiredAt === undefined) return errorResponse("Data salinan buku tidak valid.", 422);
  const conditionNote = noteResult.value ?? null;

  try {
    const copy = await prisma.$transaction(async (tx) => {
      const book = await tx.book.findFirst({ where: { id: bookId, schoolId: auth.schoolId, isActive: true, category: { is: { isActive: true } } }, select: { id: true } });
      if (!book) throw new Error("BOOK_NOT_FOUND");
      if (shelfId && !(await tx.shelf.findUnique({ where: { id: shelfId, schoolId: auth.schoolId }, select: { id: true } }))) throw new Error("SHELF_NOT_FOUND");
      const created = await tx.bookCopy.create({ data: { schoolId: auth.schoolId, bookId, shelfId, barcode, status: "TERSEDIA", isActive: true, conditionNote, acquiredAt }, select: librarianSelect });
      await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "CREATE", entityType: "BookCopy", entityId: created.id, newData: jsonValue(created), ipAddress: getClientIp(request) } });
      return created;
    });
    return NextResponse.json({ data: copy }, { status: 201, headers: noStoreHeaders });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "BOOK_NOT_FOUND") return errorResponse("Buku tidak ditemukan atau tidak aktif.", 422);
    if (error instanceof Error && error.message === "SHELF_NOT_FOUND") return errorResponse("Rak tidak ditemukan.", 422);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return errorResponse("Barcode sudah digunakan.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
