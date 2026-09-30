import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";

export const runtime = "nodejs";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_PAGE = 10_000;
const statuses = ["TERSEDIA", "DIPINJAM", "RUSAK", "HILANG"] as const;

type CopyStatus = (typeof statuses)[number];

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function integer(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}
function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}
function onlyFields(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
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
  const page = integer(url.searchParams.get("page"), 1, MAX_PAGE);
  const limit = integer(url.searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
  const bookId = url.searchParams.get("bookId")?.trim() ?? "";
  const shelfId = url.searchParams.get("shelfId")?.trim() ?? "";
  const search = url.searchParams.get("search")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";

  if ((bookId && !uuid(bookId)) || (shelfId && !uuid(shelfId))) return errorResponse("ID filter tidak valid.", 422);
  if (status && !statuses.includes(status as CopyStatus)) return errorResponse("Status salinan buku tidak valid.", 422);

  const where = {
    isActive: true,
    book: { isActive: true, category: { is: { isActive: true } } },
    ...(bookId ? { bookId } : {}),
    ...(shelfId ? { shelfId } : {}),
    ...(status ? { status: status as CopyStatus } : {}),
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
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("Body JSON tidak valid.", 400); }
  if (!record(body) || !onlyFields(body, ["bookId", "shelfId", "barcode", "conditionNote", "acquiredAt"])) return errorResponse("Body request tidak valid.", 422);

  const bookId = body.bookId;
  const shelfId = body.shelfId === null || body.shelfId === undefined ? null : body.shelfId;
  const barcode = typeof body.barcode === "string" ? body.barcode.trim().toUpperCase() : "";
  const conditionNote = body.conditionNote === null || body.conditionNote === undefined ? null : typeof body.conditionNote === "string" ? body.conditionNote.trim() || null : undefined;
  const acquiredAt = parseDate(body.acquiredAt);

  if (!uuid(bookId) || (shelfId !== null && !uuid(shelfId)) || !validBarcode(barcode) || conditionNote === undefined || (conditionNote !== null && conditionNote.length > 1000) || acquiredAt === undefined) return errorResponse("Data salinan buku tidak valid.", 422);

  try {
    const copy = await prisma.$transaction(async (tx) => {
      const book = await tx.book.findFirst({ where: { id: bookId, isActive: true, category: { is: { isActive: true } } }, select: { id: true } });
      if (!book) throw new Error("BOOK_NOT_FOUND");
      if (shelfId && !(await tx.shelf.findUnique({ where: { id: shelfId }, select: { id: true } }))) throw new Error("SHELF_NOT_FOUND");
      const created = await tx.bookCopy.create({ data: { bookId, shelfId, barcode, status: "TERSEDIA", isActive: true, conditionNote, acquiredAt }, select: librarianSelect });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "CREATE", entityType: "BookCopy", entityId: created.id, newData: jsonValue(created) } });
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
