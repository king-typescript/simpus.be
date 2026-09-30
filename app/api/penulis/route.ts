import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_PAGE = 10_000;
const MAX_SEARCH_LENGTH = 100;
const MAX_BODY_BYTES = 64 * 1024;

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyFields(value: Record<string, unknown>, fields: readonly string[]) {
  return Object.keys(value).every((key) => fields.includes(key));
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || null;
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
  const rawPage = url.searchParams.get("page");
  const rawLimit = url.searchParams.get("limit");
  const page = rawPage === null ? 1 : Number(rawPage);
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  const search = url.searchParams.get("search")?.trim() ?? "";

  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) return errorResponse("Parameter page tidak valid.", 422);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return errorResponse("Parameter limit tidak valid.", 422);
  if (search.length > MAX_SEARCH_LENGTH) return errorResponse("Parameter pencarian terlalu panjang.", 422);

  const where = search ? { name: { contains: search, mode: "insensitive" as const } } : {};

  try {
    const [authors, total] = await prisma.$transaction([
      prisma.author.findMany({ where, select: authorSelect, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
      prisma.author.count({ where }),
    ]);

    return NextResponse.json({ data: authors.map(toAuthorResponse), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }, { headers: noStoreHeaders });
  } catch {
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  if (!isRecord(parsed.body) || !hasOnlyFields(parsed.body, ["name"])) return errorResponse("Body request tidak valid.", 422);

  const name = typeof parsed.body.name === "string" ? parsed.body.name.replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 150) return errorResponse("Nama penulis tidak valid.", 422);

  try {
    const author = await prisma.$transaction(async (tx) => {
      const created = await tx.author.create({ data: { name }, select: authorSelect });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "CREATE", entityType: "Author", entityId: created.id, newData: jsonValue(created), ipAddress: clientIp(request) } });
      return created;
    });
    return NextResponse.json({ data: toAuthorResponse(author) }, { status: 201, headers: noStoreHeaders });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
