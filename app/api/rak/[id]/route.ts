import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CODE_LENGTH = 50;
const MAX_NAME_LENGTH = 150;
const MAX_LOCATION_LENGTH = 200;

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
const shelfDeleteSelect = {
  id: true, code: true, name: true, location: true, createdAt: true, updatedAt: true,
  _count: { select: { copies: true } },
} as const;
function toShelfResponse(shelf: { _count: { copies: number }; [key: string]: unknown }) {
  const { _count, ...data } = shelf;
  return { ...data, activeCopyCount: _count.copies };
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return errorResponse("Autentikasi diperlukan.", auth.status);
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID rak tidak valid.", 422);
  try {
    const shelf = await prisma.shelf.findUnique({ where: { id }, select: shelfSelect });
    return shelf ? NextResponse.json({ data: toShelfResponse(shelf) }, { headers: noStoreHeaders }) : errorResponse("Rak tidak ditemukan.", 404);
  } catch {
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID rak tidak valid.", 422);
  if (!acceptsJson(request)) return errorResponse("Content-Type harus application/json.", 415);

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  if (!isRecord(parsed.body) || !hasOnlyFields(parsed.body, ["code", "name", "location"])) return errorResponse("Body request tidak valid.", 422);

  const data: { code?: string; name?: string; location?: string | null } = {};
  if ("code" in parsed.body) {
    if (typeof parsed.body.code !== "string") return errorResponse("Kode rak tidak valid.", 422);
    const code = normalizeText(parsed.body.code).toUpperCase();
    if (!code || code.length > MAX_CODE_LENGTH || !/^[A-Z0-9][A-Z0-9._/-]*$/.test(code)) return errorResponse("Kode rak tidak valid.", 422);
    data.code = code;
  }
  if ("name" in parsed.body) {
    if (typeof parsed.body.name !== "string") return errorResponse("Nama rak tidak valid.", 422);
    const name = normalizeText(parsed.body.name);
    if (!name || name.length > MAX_NAME_LENGTH) return errorResponse("Nama rak tidak valid.", 422);
    data.name = name;
  }
  if ("location" in parsed.body) {
    if (parsed.body.location !== null && typeof parsed.body.location !== "string") return errorResponse("Lokasi rak tidak valid.", 422);
    const location = typeof parsed.body.location === "string" ? normalizeText(parsed.body.location) : null;
    if (location !== null && location.length > MAX_LOCATION_LENGTH) return errorResponse("Lokasi rak terlalu panjang.", 422);
    data.location = location || null;
  }
  if (!Object.keys(data).length) return errorResponse("Tidak ada perubahan.", 422);

  try {
    const shelf = await prisma.$transaction(async (tx) => {
      const current = await tx.shelf.findUnique({ where: { id }, select: shelfSelect });
      if (!current) return null;
      const unchanged = (data.code === undefined || data.code === current.code) && (data.name === undefined || data.name === current.name) && (data.location === undefined || data.location === current.location);
      if (unchanged) return current;
      const updated = await tx.shelf.update({ where: { id }, data, select: shelfSelect });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "UPDATE", entityType: "Shelf", entityId: id, oldData: jsonValue(current), newData: jsonValue(updated), ipAddress: clientIp(request) } });
      return updated;
    });
    return shelf ? NextResponse.json({ data: toShelfResponse(shelf) }, { headers: noStoreHeaders }) : errorResponse("Rak tidak ditemukan.", 404);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return errorResponse("Kode rak sudah digunakan.", 409);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") return errorResponse("Rak tidak ditemukan.", 404);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID rak tidak valid.", 422);

  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const shelf = await tx.shelf.findUnique({ where: { id }, select: shelfDeleteSelect });
      if (!shelf) return false;
      if (shelf._count.copies > 0) throw new Error("SHELF_HAS_COPIES");
      await tx.shelf.delete({ where: { id } });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "DELETE", entityType: "Shelf", entityId: id, oldData: jsonValue(shelf), ipAddress: clientIp(request) } });
      return true;
    }, { isolationLevel: "Serializable" });
    return deleted ? new NextResponse(null, { status: 204 }) : errorResponse("Rak tidak ditemukan.", 404);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "SHELF_HAS_COPIES") return errorResponse("Rak masih memiliki salinan buku.", 409);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2003") return errorResponse("Rak masih memiliki salinan buku.", 409);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
