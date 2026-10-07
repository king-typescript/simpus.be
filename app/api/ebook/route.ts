import { NextResponse } from "next/server";

import { noStoreHeaders, requireLibrarian, requireStudent } from "@/lib/auth";
import {
  assertEbookSize,
  deleteEbook,
  detectEbookFile,
  saveEbook,
} from "@/lib/ebook-storage";
import { prisma } from "@/lib/prisma";
import { getClientIp, isUuid, parsePagination, parseSearch } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders });
}

function prismaCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" ? error.code : null;
}

function safeFileName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:"*?<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

export async function GET(request: Request) {
  const auth = await requireStudent();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  const searchParams = new URL(request.url).searchParams;
  const pagination = parsePagination(searchParams, { defaultLimit: 20, maxLimit: 50, maxPage: 1000 });
  if (!pagination.ok) return errorResponse(pagination.error, 422);

  const search = parseSearch(searchParams, 100);
  if (!search.ok) return errorResponse(search.error, 422);

  const categoryId = searchParams.get("categoryId")?.trim() ?? "";
  if (categoryId && !isUuid(categoryId)) return errorResponse("Parameter categoryId tidak valid.", 422);

  const where = {
    status: "AKTIF" as const,
    book: {
      isActive: true,
      ...(categoryId ? { categoryId } : {}),
      ...(search.value ? {
        OR: [
          { title: { contains: search.value, mode: "insensitive" as const } },
          { authors: { some: { name: { contains: search.value, mode: "insensitive" as const } } } },
        ],
      } : {}),
    },
  };

  const { page, limit } = pagination.value;
  const [total, ebooks] = await prisma.$transaction([
    prisma.ebook.count({ where }),
    prisma.ebook.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ book: { title: "asc" } }, { createdAt: "desc" }],
      select: {
        id: true,
        fileName: true,
        contentType: true,
        fileSize: true,
        createdAt: true,
        book: {
          select: {
            id: true,
            title: true,
            isbn: true,
            publisher: true,
            publicationYear: true,
            coverUrl: true,
            category: { select: { id: true, name: true, ddcCode: true } },
            authors: { select: { id: true, name: true }, orderBy: { name: "asc" } },
          },
        },
      },
    }),
  ]);

  const ids = ebooks.map((ebook) => ebook.id);
  const accesses = ids.length === 0 ? [] : await prisma.ebookAccess.findMany({
    where: { studentId: auth.student.id, ebookId: { in: ids }, status: "AKTIF", expiresAt: { gt: new Date() } },
    select: { ebookId: true, expiresAt: true, extensionCount: true },
  });
  const accessByEbook = new Map(accesses.map((access) => [access.ebookId, access]));

  return NextResponse.json({
    data: ebooks.map((ebook) => {
      const access = accessByEbook.get(ebook.id);
      return {
        id: ebook.id,
        fileName: ebook.fileName,
        contentType: ebook.contentType,
        fileSize: ebook.fileSize.toString(),
        createdAt: ebook.createdAt,
        book: ebook.book,
        access: access ? { status: "AKTIF" as const, expiresAt: access.expiresAt, extensionCount: access.extensionCount } : null,
      };
    }),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return errorResponse("Content-Type harus multipart/form-data.", 415);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("Form upload tidak valid.", 400);
  }

  const bookId = formData.get("bookId");
  const file = formData.get("file");
  if (typeof bookId !== "string" || !isUuid(bookId) || !(file instanceof File)) {
    return errorResponse("bookId dan file wajib diisi.", 422);
  }

  const fileName = safeFileName(file.name);
  if (!fileName || fileName.length > 255) return errorResponse("Nama file tidak valid.", 422);

  let bytes: Uint8Array;
  try {
    assertEbookSize(file.size);
    bytes = new Uint8Array(await file.arrayBuffer());
    assertEbookSize(bytes.byteLength);
  } catch {
    return errorResponse("Ukuran file e-book tidak valid.", 422);
  }

  const detected = detectEbookFile(bytes, fileName);
  if (!detected) return errorResponse("File harus berupa PDF atau EPUB yang valid.", 422);

  const book = await prisma.book.findFirst({
    where: { id: bookId, isActive: true, category: { isActive: true } },
    select: { id: true, title: true, ebook: { select: { id: true } } },
  });
  if (!book) return errorResponse("Buku tidak ditemukan atau tidak aktif.", 404);
  if (book.ebook) return errorResponse("Buku ini sudah memiliki e-book.", 409);

  let saved: Awaited<ReturnType<typeof saveEbook>> | null = null;
  try {
    saved = await saveEbook(bytes, fileName, detected);
    const ebook = await prisma.$transaction(async (tx) => {
      const created = await tx.ebook.create({
        data: {
          bookId: book.id,
          fileKey: saved!.key,
          fileName: saved!.fileName,
          contentType: saved!.contentType,
          fileSize: BigInt(saved!.size),
          status: "AKTIF",
        },
        select: {
          id: true,
          bookId: true,
          fileName: true,
          contentType: true,
          fileSize: true,
          status: true,
          createdAt: true,
          book: { select: { id: true, title: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: auth.user.id,
          action: "CREATE",
          entityType: "Ebook",
          entityId: created.id,
          newData: jsonValue({
            ebookId: created.id,
            bookId: created.bookId,
            fileName: created.fileName,
            contentType: created.contentType,
            fileSize: created.fileSize.toString(),
            status: created.status,
          }),
          ipAddress: getClientIp(request),
        },
      });
      return created;
    });

    return NextResponse.json({
      data: {
        ...ebook,
        fileSize: ebook.fileSize.toString(),
      },
    }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    if (saved) {
      try { await deleteEbook(saved.key); } catch { /* cleanup job can handle orphan objects */ }
    }

    if (prismaCode(error) === "P2002") return errorResponse("Buku ini sudah memiliki e-book.", 409);
    return errorResponse("Gagal menyimpan e-book.", 500);
  }
}
