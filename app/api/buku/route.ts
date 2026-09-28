import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";

export const runtime = "nodejs";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function integer(value: string | null, fallback: number, maximum = 1000) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
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

const bookSelect = {
  id: true, isbn: true, title: true, isActive: true, publisher: true,
  publicationYear: true, edition: true, description: true, coverUrl: true,
  createdAt: true, updatedAt: true,
  category: { select: { id: true, name: true, ddcCode: true } },
  authors: { select: { id: true, name: true }, orderBy: { name: "asc" as const } },
} as const;

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return errorResponse("Autentikasi diperlukan.", 401);

  const url = new URL(request.url);
  const page = integer(url.searchParams.get("page"), 1, 10000);
  const limit = Math.min(integer(url.searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT), MAX_LIMIT);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const categoryId = url.searchParams.get("categoryId")?.trim() ?? "";
  const authorId = url.searchParams.get("authorId")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";
  const statuses = ["TERSEDIA", "DIPINJAM", "RUSAK", "HILANG"] as const;

  if ((categoryId && !uuid(categoryId)) || (authorId && !uuid(authorId))) return errorResponse("ID filter tidak valid.", 422);
  if (status && !statuses.includes(status as (typeof statuses)[number])) return errorResponse("Status buku tidak valid.", 422);

  const where = {
    isActive: true,
    category: { is: { isActive: true } },
    ...(categoryId ? { categoryId } : {}),
    ...(authorId ? { authors: { some: { id: authorId } } } : {}),
    ...(status ? { copies: { some: { status: status as (typeof statuses)[number] } } } : {}),
    ...(search ? { OR: [
      { title: { contains: search, mode: "insensitive" as const } },
      { isbn: { contains: search, mode: "insensitive" as const } },
      { publisher: { contains: search, mode: "insensitive" as const } },
      { authors: { some: { name: { contains: search, mode: "insensitive" as const } } } },
      { category: { OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { ddcCode: { contains: search, mode: "insensitive" as const } },
      ] } },
    ] } : {}),
  };

  try {
    const [data, total] = await prisma.$transaction([
      prisma.book.findMany({ where, select: bookSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit }),
      prisma.book.count({ where }),
    ]);
    return NextResponse.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }, { headers: noStoreHeaders });
  } catch {
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("Body JSON tidak valid.", 400); }
  if (!record(body)) return errorResponse("Body request tidak valid.", 422);

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const isbn = typeof body.isbn === "string" && body.isbn.trim() ? body.isbn.trim() : null;
  const publisher = typeof body.publisher === "string" && body.publisher.trim() ? body.publisher.trim() : null;
  const edition = typeof body.edition === "string" && body.edition.trim() ? body.edition.trim() : null;
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  const coverUrl = typeof body.coverUrl === "string" && body.coverUrl.trim() ? body.coverUrl.trim() : null;
  const categoryId = body.categoryId;
  const authorIds = body.authorIds;
  const publicationYear = body.publicationYear === undefined || body.publicationYear === null ? null : body.publicationYear;
  const validYear = publicationYear === null || (typeof publicationYear === "number" && Number.isInteger(publicationYear) && publicationYear >= 1000 && publicationYear <= new Date().getFullYear() + 1);

  if (
    !title ||
    title.length > 300 ||
    (isbn !== null && (isbn.length > 20 || !/^[0-9Xx-]{10,17}$/.test(isbn))) ||
    (publisher !== null && publisher.length > 200) ||
    (edition !== null && edition.length > 100) ||
    (description !== null && description.length > 5000) ||
    (coverUrl !== null && (coverUrl.length > 2048 || !validCoverUrl(coverUrl))) ||
    !uuid(categoryId) ||
    !Array.isArray(authorIds) ||
    !authorIds.length ||
    authorIds.length > 20 ||
    !authorIds.every(uuid) ||
    !validYear
  ) return errorResponse("Data buku tidak valid.", 422);
  const uniqueAuthorIds = [...new Set(authorIds)];

  try {
    const data = await prisma.$transaction(async (tx) => {
      const [category, authors] = await Promise.all([
        tx.category.findFirst({ where: { id: categoryId, isActive: true }, select: { id: true } }),
        tx.author.findMany({ where: { id: { in: uniqueAuthorIds } }, select: { id: true } }),
      ]);
      if (!category) throw new Error("CATEGORY_NOT_FOUND");
      if (authors.length !== uniqueAuthorIds.length) throw new Error("AUTHOR_NOT_FOUND");
      const book = await tx.book.create({ data: { isbn, title, publisher, publicationYear, edition, description, coverUrl, categoryId, authors: { connect: uniqueAuthorIds.map((id) => ({ id })) } }, select: bookSelect });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "CREATE", entityType: "Book", entityId: book.id, newData: jsonValue(book) } });
      return book;
    });
    return NextResponse.json({ data }, { status: 201, headers: noStoreHeaders });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "CATEGORY_NOT_FOUND") return errorResponse("Kategori tidak ditemukan.", 422);
    if (error instanceof Error && error.message === "AUTHOR_NOT_FOUND") return errorResponse("Salah satu penulis tidak ditemukan.", 422);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return errorResponse("ISBN sudah digunakan.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
