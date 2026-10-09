import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";
import {
  getClientIp,
  hasOnlyFields,
  isJsonContentType,
  isRecord,
  parsePagination,
  parseSearch,
  parseOptionalString,
  parseRequiredString,
} from "@/lib/validation";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CODE_LENGTH = 50;
const MAX_NAME_LENGTH = 150;
const MAX_LOCATION_LENGTH = 200;

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}
function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
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
  const pagination = parsePagination(url.searchParams, { defaultLimit: 20, maxLimit: 100, maxPage: 10_000 });
  if (!pagination.ok) return errorResponse(pagination.error, 422);
  const searchResult = parseSearch(url.searchParams, 100);
  if (!searchResult.ok) return errorResponse(searchResult.error, 422);
  const { page, limit } = pagination.value;
  const search = searchResult.value;

  const where = search ? { OR: [
    { code: { contains: search, mode: "insensitive" as const } },
    { name: { contains: search, mode: "insensitive" as const } },
    { location: { contains: search, mode: "insensitive" as const } },
  ] } : {};

  try {
    const [shelves, total] = await prisma.$transaction([
      prisma.shelf.findMany({ where: { ...where, schoolId: auth.schoolId }, select: shelfSelect, orderBy: [{ code: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
      prisma.shelf.count({ where: { ...where, schoolId: auth.schoolId } }),
    ]);
    return NextResponse.json({ data: shelves.map(toShelfResponse), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }, { headers: noStoreHeaders });
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
  if (!isRecord(parsed.body) || !hasOnlyFields(parsed.body, ["code", "name", "location"])) return errorResponse("Body request tidak valid.", 422);

  const codeResult = parseRequiredString(parsed.body.code, { field: "Kode rak", maxLength: MAX_CODE_LENGTH });
  const nameResult = parseRequiredString(parsed.body.name, { field: "Nama rak", maxLength: MAX_NAME_LENGTH });
  const locationResult = parseOptionalString(parsed.body.location, { field: "Lokasi rak", maxLength: MAX_LOCATION_LENGTH });
  if (!codeResult.ok || !/^[A-Z0-9][A-Z0-9._/-]*$/.test(codeResult.value.toUpperCase())) return errorResponse("Kode rak tidak valid.", 422);
  if (!nameResult.ok || !locationResult.ok) return errorResponse("Data rak tidak valid.", 422);
  const code = codeResult.value.toUpperCase();
  const name = nameResult.value;
  const location = locationResult.value ?? null;

  try {
    const shelf = await prisma.$transaction(async (tx) => {
      const created = await tx.shelf.create({ data: { schoolId: auth.schoolId, code, name, location }, select: shelfSelect });
      await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "CREATE", entityType: "Shelf", entityId: created.id, newData: jsonValue(created), ipAddress: getClientIp(request) } });
      return created;
    });
    return NextResponse.json({ data: toShelfResponse(shelf) }, { status: 201, headers: noStoreHeaders });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return errorResponse("Kode rak sudah digunakan.", 409);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
