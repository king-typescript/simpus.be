import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBookCoverUrl } from "@/lib/book-cover-url";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";
import {
  getClientIp,
  hasOnlyFields,
  isJsonContentType,
  isRecord,
  isUuid,
  normalizeText,
  parseEnum,
  parseBookCoverUrl,
  parseOptionalString,
  parsePagination,
  parseRequiredString,
  parseSearch,
} from "@/lib/validation";

export const runtime = "nodejs";
function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

async function withCoverUrl<T extends { coverUrl: string | null }>(book: T) {
  return { ...book, coverUrl: await getBookCoverUrl(book.coverUrl) };
}

const bookSelect = {
  id: true, isbn: true, title: true, isActive: true, publisher: true,
  publicationYear: true, edition: true, description: true, coverUrl: true,
  createdAt: true, updatedAt: true,
  category: { select: { id: true, name: true, ddcCode: true } },
  authors: { select: { id: true, name: true }, orderBy: { name: "asc" as const } },
  _count: { select: { copies: { where: { isActive: true } } } },
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
  const search = searchResult.value;
  const categoryId = url.searchParams.get("categoryId")?.trim() ?? "";
  const authorId = url.searchParams.get("authorId")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";
  const statusResult = status ? parseEnum(status, ["TERSEDIA", "DIPINJAM", "RUSAK", "HILANG"] as const, "Status buku") : null;

  if ((categoryId && !isUuid(categoryId)) || (authorId && !isUuid(authorId))) return errorResponse("ID filter tidak valid.", 422);
  if (statusResult && !statusResult.ok) return errorResponse(statusResult.error, 422);

  const where = {
    schoolId: auth.schoolId,
    isActive: true,
    category: { is: { isActive: true } },
    ...(categoryId ? { categoryId } : {}),
    ...(authorId ? { authors: { some: { id: authorId } } } : {}),
    ...(statusResult?.ok ? { copies: { some: { status: statusResult.value } } } : {}),
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
      prisma.book.findMany({ where: { ...where, schoolId: auth.schoolId }, select: bookSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit }),
      prisma.book.count({ where: { ...where, schoolId: auth.schoolId } }),
    ]);
    const books = await Promise.all(data.map(async ({ _count, ...book }) => ({
      ...(await withCoverUrl(book)),
      copyCount: _count.copies,
    })));
    return NextResponse.json({ data: books, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }, { headers: noStoreHeaders });
  } catch {
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  if (!isJsonContentType(request)) return errorResponse("Content-Type harus application/json.", 415);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("Body JSON tidak valid.", 400); }
  if (!isRecord(body) || !hasOnlyFields(body, ["isbn", "title", "publisher", "publicationYear", "edition", "description", "coverUrl", "categoryId", "authorIds"])) return errorResponse("Body request tidak valid.", 422);

  const titleResult = parseRequiredString(body.title, { field: "Judul", maxLength: 300 });
  const isbn = body.isbn === undefined || body.isbn === null ? null : typeof body.isbn === "string" ? normalizeText(body.isbn) || null : undefined;
  const publisherResult = parseOptionalString(body.publisher, { field: "Penerbit", maxLength: 200 });
  const editionResult = parseOptionalString(body.edition, { field: "Edisi", maxLength: 100 });
  const descriptionResult = parseOptionalString(body.description, { field: "Deskripsi", maxLength: 5000 });
  const coverResult = parseBookCoverUrl(body.coverUrl, "URL sampul");
  const categoryId = body.categoryId;
  const authorIds = body.authorIds;
  const publicationYear = body.publicationYear === undefined || body.publicationYear === null ? null : body.publicationYear;
  const validYear = publicationYear === null || (typeof publicationYear === "number" && Number.isSafeInteger(publicationYear) && publicationYear >= 1000 && publicationYear <= new Date().getFullYear() + 1);

  if (!titleResult.ok || !publisherResult.ok || !editionResult.ok || !descriptionResult.ok || !coverResult.ok || isbn === undefined || (isbn !== null && (isbn.length > 20 || !/^[0-9Xx-]{10,17}$/.test(isbn))) || !isUuid(categoryId) || !Array.isArray(authorIds) || !authorIds.length || authorIds.length > 20 || !authorIds.every(isUuid) || !validYear) return errorResponse("Data buku tidak valid.", 422);
  const title = titleResult.value;
  const publisher = publisherResult.value ?? null;
  const edition = editionResult.value ?? null;
  const description = descriptionResult.value ?? null;
  const coverUrl = coverResult.value;
  const uniqueAuthorIds = [...new Set(authorIds)];

  try {
    const data = await prisma.$transaction(async (tx) => {
      const [category, authors] = await Promise.all([
        tx.category.findFirst({ where: { id: categoryId, schoolId: auth.schoolId, isActive: true }, select: { id: true } }),
        tx.author.findMany({ where: { id: { in: uniqueAuthorIds }, schoolId: auth.schoolId }, select: { id: true } }),
      ]);
      if (!category) throw new Error("CATEGORY_NOT_FOUND");
      if (authors.length !== uniqueAuthorIds.length) throw new Error("AUTHOR_NOT_FOUND");
      const book = await tx.book.create({ data: { schoolId: auth.schoolId, isbn, title, publisher, publicationYear, edition, description, coverUrl, categoryId, authors: { connect: uniqueAuthorIds.map((id) => ({ id })) } }, select: bookSelect });
      await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "CREATE", entityType: "Book", entityId: book.id, newData: jsonValue(book), ipAddress: getClientIp(request) } });
      return book;
    });
    return NextResponse.json({ data: await withCoverUrl(data) }, { status: 201, headers: noStoreHeaders });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "CATEGORY_NOT_FOUND") return errorResponse("Kategori tidak ditemukan.", 422);
    if (error instanceof Error && error.message === "AUTHOR_NOT_FOUND") return errorResponse("Salah satu penulis tidak ditemukan.", 422);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return errorResponse("ISBN sudah digunakan.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
