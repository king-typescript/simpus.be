import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_PAGE = 10_000;
const MAX_SEARCH_LENGTH = 100;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CODE_LENGTH = 50;
const MAX_NAME_LENGTH = 150;
const MAX_LOCATION_LENGTH = 200;

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOnlyFields(value: Record<string, unknown>, fields: readonly string[]) {
  return Object.keys(value).every((key) => fields.includes(key));
}
function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}
function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}
function acceptsJson(request: Request) {
  return request.headers.get("content-type")?.toLowerCase().startsWith("application/json") ?? false;
}
async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return { ok: false, response: errorResponse("Body request terlalu besar.", 413) };
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return { ok: false, response: errorResponse("Body request terlalu besar.", 413) };
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: errorResponse("Body JSON tidak valid.", 400) };
  }
}

const shelfSelect = {
  id: true, code: true, name: true, location: true, createdAt: true, updatedAt: true,
  _count: { select: { copies: { where: { isActive: true } } } },
} as const;

function toShelfResponse(shelf: { _count: { copies: number }; [key: string]: unknown }) {
  const { _count, ...data } = shelf;
  return { ...data, activeCopyCount: _count.copies };
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

  const where = search ? { OR: [
    { code: { contains: search, mode: "insensitive" as const } },
    { name: { contains: search, mode: "insensitive" as const } },
    { location: { contains: search, mode: "insensitive" as const } },
  ] } : {};

  try {
    const [shelves, total] = await prisma.$transaction([
      prisma.shelf.findMany({ where, select: shelfSelect, orderBy: [{ code: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
      prisma.shelf.count({ where }),
    ]);
    return NextResponse.json({ data: shelves.map(toShelfResponse), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }, { headers: noStoreHeaders });
  } catch {
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  if (!acceptsJson(request)) return errorResponse("Content-Type harus application/json.", 415);

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  if (!isRecord(parsed.body) || !hasOnlyFields(parsed.body, ["code", "name", "location"])) return errorResponse("Body request tidak valid.", 422);

  const code = typeof parsed.body.code === "string" ? normalizeText(parsed.body.code).toUpperCase() : "";
  const name = typeof parsed.body.name === "string" ? normalizeText(parsed.body.name) : "";
  const location = parsed.body.location === null || parsed.body.location === undefined
    ? null
    : typeof parsed.body.location === "string" ? normalizeText(parsed.body.location) || null : undefined;

  if (!code || code.length > MAX_CODE_LENGTH || !/^[A-Z0-9][A-Z0-9._/-]*$/.test(code) || !name || name.length > MAX_NAME_LENGTH || location === undefined || (location !== null && location.length > MAX_LOCATION_LENGTH)) return errorResponse("Data rak tidak valid.", 422);

  try {
    const shelf = await prisma.$transaction(async (tx) => {
      const created = await tx.shelf.create({ data: { code, name, location }, select: shelfSelect });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "CREATE", entityType: "Shelf", entityId: created.id, newData: jsonValue(created), ipAddress: clientIp(request) } });
      return created;
    });
    return NextResponse.json({ data: toShelfResponse(shelf) }, { status: 201, headers: noStoreHeaders });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return errorResponse("Kode rak sudah digunakan.", 409);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
