import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}
function hasOnlyFields(value: Record<string, unknown>, fields: readonly string[]) {
  return Object.keys(value).every((key) => fields.includes(key));
}

const categorySelect = {
  id: true, name: true, ddcCode: true, description: true, isActive: true,
  createdAt: true, updatedAt: true,
  _count: { select: { books: { where: { isActive: true } } } },
} as const;

function toCategoryResponse(category: { _count: { books: number }; [key: string]: unknown }) {
  const { _count, ...data } = category;
  return { ...data, activeBookCount: _count.books };
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return errorResponse("Autentikasi diperlukan.", auth.status);
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID kategori tidak valid.", 422);

  try {
    const category = await prisma.category.findFirst({ where: { id, isActive: true }, select: categorySelect });
    return category ? NextResponse.json({ data: toCategoryResponse(category) }, { headers: noStoreHeaders }) : errorResponse("Kategori tidak ditemukan.", 404);
  } catch {
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID kategori tidak valid.", 422);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("Body JSON tidak valid.", 400); }
  if (!isRecord(body) || !hasOnlyFields(body, ["name", "ddcCode", "description"])) return errorResponse("Body request tidak valid.", 422);

  const data: { name?: string; ddcCode?: string; description?: string | null } = {};
  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 150) return errorResponse("Nama kategori tidak valid.", 422);
    data.name = body.name.trim();
  }
  if ("ddcCode" in body) {
    const ddcCode = typeof body.ddcCode === "string" ? body.ddcCode.trim() : "";
    if (ddcCode.length > 20 || !/^\d{3}(?:\.\d{1,10})?$/.test(ddcCode)) return errorResponse("Kode DDC tidak valid.", 422);
    data.ddcCode = ddcCode;
  }
  if ("description" in body) {
    if (body.description !== null && typeof body.description !== "string") return errorResponse("Deskripsi kategori tidak valid.", 422);
    const description = typeof body.description === "string" ? body.description.trim() : null;
    if (description !== null && description.length > 1000) return errorResponse("Deskripsi kategori terlalu panjang.", 422);
    data.description = description || null;
  }
  if (!Object.keys(data).length) return errorResponse("Tidak ada perubahan.", 422);

  try {
    const category = await prisma.$transaction(async (tx) => {
      const current = await tx.category.findFirst({ where: { id, isActive: true }, select: categorySelect });
      if (!current) return null;
      const updated = await tx.category.update({ where: { id }, data, select: categorySelect });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "UPDATE", entityType: "Category", entityId: id, oldData: jsonValue(current), newData: jsonValue(updated) } });
      return updated;
    });
    return category ? NextResponse.json({ data: toCategoryResponse(category) }, { headers: noStoreHeaders }) : errorResponse("Kategori tidak ditemukan.", 404);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return errorResponse("Kode DDC sudah digunakan.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID kategori tidak valid.", 422);

  try {
    const deactivated = await prisma.$transaction(async (tx) => {
      const category = await tx.category.findFirst({
        where: { id, isActive: true },
        select: { ...categorySelect, _count: { select: { books: true } } },
      });
      if (!category) return false;
      if (category._count.books > 0) throw new Error("CATEGORY_HAS_BOOKS");
      await tx.category.update({ where: { id }, data: { isActive: false } });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "DEACTIVATE", entityType: "Category", entityId: id, oldData: jsonValue(category), newData: jsonValue({ ...category, isActive: false }) } });
      return true;
    }, { isolationLevel: "Serializable" });
    return deactivated ? new NextResponse(null, { status: 204 }) : errorResponse("Kategori tidak ditemukan.", 404);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "CATEGORY_HAS_BOOKS") return errorResponse("Kategori masih digunakan oleh buku.", 409);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
