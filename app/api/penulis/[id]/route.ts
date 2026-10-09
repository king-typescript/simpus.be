import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";
import {
  getClientIp,
  hasOnlyFields,
  isJsonContentType,
  isRecord,
  isUuid,
  parseRequiredString,
} from "@/lib/validation";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };
const MAX_BODY_BYTES = 64 * 1024;

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

const authorSelect = {
  id: true, name: true, createdAt: true, updatedAt: true,
  _count: { select: { books: { where: { isActive: true } } } },
} as const;
function toAuthorResponse(author: { _count: { books: number }; [key: string]: unknown }) {
  const { _count, ...data } = author;
  return { ...data, activeBookCount: _count.books };
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return errorResponse("Autentikasi diperlukan.", auth.status);
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID penulis tidak valid.", 422);

  try {
    const author = await prisma.author.findUnique({ where: { id, schoolId: auth.schoolId }, select: authorSelect });
    return author ? NextResponse.json({ data: toAuthorResponse(author) }, { headers: noStoreHeaders }) : errorResponse("Penulis tidak ditemukan.", 404);
  } catch {
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID penulis tidak valid.", 422);

  if (!isJsonContentType(request)) return errorResponse("Content-Type harus application/json.", 415);

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  if (!isRecord(parsed.body) || !hasOnlyFields(parsed.body, ["name"])) return errorResponse("Body request tidak valid.", 422);
  if (!("name" in parsed.body)) return errorResponse("Tidak ada perubahan.", 422);

  const nameResult = parseRequiredString(parsed.body.name, { field: "Nama penulis", maxLength: 150 });
  if (!nameResult.ok) return errorResponse(nameResult.error, 422);
  const name = nameResult.value;

  try {
    const author = await prisma.$transaction(async (tx) => {
      const current = await tx.author.findUnique({ where: { id, schoolId: auth.schoolId }, select: authorSelect });
      if (!current) return null;
      const updated = await tx.author.update({ where: { id, schoolId: auth.schoolId }, data: { name }, select: authorSelect });
      await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "UPDATE", entityType: "Author", entityId: id, oldData: jsonValue(current), newData: jsonValue(updated), ipAddress: getClientIp(request) } });
      return updated;
    });
    return author ? NextResponse.json({ data: toAuthorResponse(author) }, { headers: noStoreHeaders }) : errorResponse("Penulis tidak ditemukan.", 404);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID penulis tidak valid.", 422);

  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const author = await tx.author.findUnique({ where: { id, schoolId: auth.schoolId }, select: { ...authorSelect, _count: { select: { books: true } } } });
      if (!author) return false;
      if (author._count.books > 0) throw new Error("AUTHOR_HAS_BOOKS");
      await tx.author.delete({ where: { id, schoolId: auth.schoolId } });
      await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "DELETE", entityType: "Author", entityId: id, oldData: jsonValue(author), ipAddress: getClientIp(request) } });
      return true;
    }, { isolationLevel: "Serializable" });
    return deleted ? new NextResponse(null, { status: 204 }) : errorResponse("Penulis tidak ditemukan.", 404);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "AUTHOR_HAS_BOOKS") return errorResponse("Penulis masih digunakan oleh buku.", 409);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2003") return errorResponse("Penulis masih digunakan oleh buku.", 409);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}