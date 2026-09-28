import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validCoverUrl(value: string | null) {
  if (value === null) return true;

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

const detailSelect = {
  id: true, isbn: true, title: true, isActive: true, publisher: true, publicationYear: true,
  edition: true, description: true, coverUrl: true, createdAt: true, updatedAt: true,
  category: { select: { id: true, name: true, ddcCode: true, description: true } },
  authors: { select: { id: true, name: true }, orderBy: { name: "asc" as const } },
  copies: { select: { id: true, barcode: true, status: true, conditionNote: true, acquiredAt: true, shelf: { select: { id: true, code: true, name: true, location: true } } }, orderBy: { barcode: "asc" as const } },
} as const;

export async function GET(_request: Request, context: Context) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return errorResponse("Autentikasi diperlukan.", 401);
  const { id } = await context.params;
  if (!uuid(id)) return errorResponse("ID buku tidak valid.", 422);
  try {
    const data = await prisma.book.findFirst({ where: { id, isActive: true, category: { is: { isActive: true } } }, select: detailSelect });
    return data ? NextResponse.json({ data }, { headers: noStoreHeaders }) : errorResponse("Buku tidak ditemukan.", 404);
  } catch { return errorResponse("Terjadi kesalahan pada server.", 500); }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!uuid(id)) return errorResponse("ID buku tidak valid.", 422);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("Body JSON tidak valid.", 400); }
  if (!record(body)) return errorResponse("Body request tidak valid.", 422);

  const data: { isbn?: string | null; title?: string; publisher?: string | null; publicationYear?: number | null; edition?: string | null; description?: string | null; coverUrl?: string | null; categoryId?: string } = {};
  if ("isbn" in body) {
    if (body.isbn !== null && typeof body.isbn !== "string") return errorResponse("ISBN tidak valid.", 422);
    const value = typeof body.isbn === "string" && body.isbn.trim() ? body.isbn.trim() : null;
    if (value !== null && (value.length > 20 || !/^[0-9Xx-]{10,17}$/.test(value))) return errorResponse("ISBN tidak valid.", 422);
    data.isbn = value;
  }
  if ("title" in body) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 300) return errorResponse("Judul tidak valid.", 422);
    data.title = body.title.trim();
  }
  for (const field of ["publisher", "edition", "description", "coverUrl"] as const) {
    if (field in body) {
        if (body[field] !== null && typeof body[field] !== "string") return errorResponse(`${field} tidak valid.`, 422);
      const value = typeof body[field] === "string" && body[field].trim() ? body[field].trim() : null;
      const maximum = field === "publisher" ? 200 : field === "edition" ? 100 : field === "description" ? 5000 : 2048;
      if (value !== null && (value.length > maximum || (field === "coverUrl" && !validCoverUrl(value)))) return errorResponse(`${field} tidak valid.`, 422);
      data[field] = value;
    }
  }
  if ("publicationYear" in body) {
    if (body.publicationYear !== null && (typeof body.publicationYear !== "number" || !Number.isInteger(body.publicationYear) || body.publicationYear < 1000 || body.publicationYear > new Date().getFullYear() + 1)) return errorResponse("Tahun terbit tidak valid.", 422);
    data.publicationYear = body.publicationYear as number | null;
  }
  if ("categoryId" in body) {
    if (!uuid(body.categoryId)) return errorResponse("Category ID tidak valid.", 422);
    data.categoryId = body.categoryId;
  }
  const authorIds = "authorIds" in body ? body.authorIds : undefined;
  if (authorIds !== undefined && (!Array.isArray(authorIds) || !authorIds.length || authorIds.length > 20 || !authorIds.every(uuid))) return errorResponse("Daftar penulis tidak valid.", 422);
  if (!Object.keys(data).length && authorIds === undefined) return errorResponse("Tidak ada perubahan.", 422);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (!(await tx.book.findFirst({ where: { id, isActive: true }, select: { id: true } }))) return null;
      if (data.categoryId && !(await tx.category.findFirst({ where: { id: data.categoryId, isActive: true }, select: { id: true } }))) throw new Error("CATEGORY_NOT_FOUND");
      const uniqueAuthors = authorIds === undefined ? undefined : [...new Set(authorIds)];
      if (uniqueAuthors) {
        const count = await tx.author.count({ where: { id: { in: uniqueAuthors } } });
        if (count !== uniqueAuthors.length) throw new Error("AUTHOR_NOT_FOUND");
      }
      const book = await tx.book.update({ where: { id }, data: { ...data, ...(uniqueAuthors ? { authors: { set: uniqueAuthors.map((authorId) => ({ id: authorId })) } } : {}) }, select: detailSelect });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "UPDATE", entityType: "Book", entityId: id, newData: jsonValue(book) } });
      return book;
    });
    return updated ? NextResponse.json({ data: updated }, { headers: noStoreHeaders }) : errorResponse("Buku tidak ditemukan.", 404);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "CATEGORY_NOT_FOUND") return errorResponse("Kategori tidak ditemukan.", 422);
    if (error instanceof Error && error.message === "AUTHOR_NOT_FOUND") return errorResponse("Salah satu penulis tidak ditemukan.", 422);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return errorResponse("ISBN sudah digunakan.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!uuid(id)) return errorResponse("ID buku tidak valid.", 422);
  try {
    const deleted = await prisma.$transaction(async (tx) => {
      if (!(await tx.book.findFirst({ where: { id, isActive: true }, select: { id: true } }))) return false;
      await tx.book.update({ where: { id }, data: { isActive: false } });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "DEACTIVATE", entityType: "Book", entityId: id } });
      return true;
    });
    return deleted ? new NextResponse(null, { status: 204 }) : errorResponse("Buku tidak ditemukan.", 404);
  } catch { return errorResponse("Terjadi kesalahan pada server.", 500); }
}
