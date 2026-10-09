import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";
import {
  getClientIp,
  hasOnlyFields,
  isJsonContentType,
  isRecord,
  parsePagination,
  parseRequiredString,
  parseSearch,
} from "@/lib/validation";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse("Body request terlalu besar.", 413) };
  }

  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return { ok: false, response: errorResponse("Body request terlalu besar.", 413) };
    }
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: errorResponse("Body JSON tidak valid.", 400) };
  }
}

const authorSelect = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { books: { where: { isActive: true } } } },
} as const;

function toAuthorResponse(author: { _count: { books: number }; [key: string]: unknown }) {
  const { _count, ...data } = author;
  return { ...data, activeBookCount: _count.books };
}

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return errorResponse("Autentikasi diperlukan.", auth.status);

  const url = new URL(request.url);
  const pagination = parsePagination(url.searchParams);
  if (!pagination.ok) return errorResponse(pagination.error, 422);
  const searchResult = parseSearch(url.searchParams);
  if (!searchResult.ok) return errorResponse(searchResult.error, 422);
  const { page, limit } = pagination.value;
  const search = searchResult.value;

  const where = { schoolId: auth.schoolId, ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}) };

  try {
    const [authors, total] = await prisma.$transaction([
      prisma.author.findMany({ where: { ...where, schoolId: auth.schoolId }, select: authorSelect, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
      prisma.author.count({ where: { ...where, schoolId: auth.schoolId } }),
    ]);

    return NextResponse.json({ data: authors.map(toAuthorResponse), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }, { headers: noStoreHeaders });
  } catch {
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  if (!isJsonContentType(request)) return errorResponse("Content-Type harus application/json.", 415);

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  if (!isRecord(parsed.body) || !hasOnlyFields(parsed.body, ["name"])) return errorResponse("Body request tidak valid.", 422);

  const nameResult = parseRequiredString(parsed.body.name, { field: "Nama penulis", maxLength: 150 });
  if (!nameResult.ok) return errorResponse(nameResult.error, 422);
  const name = nameResult.value;

  try {
    const author = await prisma.$transaction(async (tx) => {
      const created = await tx.author.create({ data: { schoolId: auth.schoolId, name }, select: authorSelect });
      await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "CREATE", entityType: "Author", entityId: created.id, newData: jsonValue(created), ipAddress: getClientIp(request) } });
      return created;
    });
    return NextResponse.json({ data: toAuthorResponse(author) }, { status: 201, headers: noStoreHeaders });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
