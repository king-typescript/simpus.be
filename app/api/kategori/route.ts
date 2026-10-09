import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";
import {
  getClientIp,
  hasOnlyFields,
  isJsonContentType,
  isRecord,
  normalizeText,
  parseEnum,
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

const categorySelect = {
  id: true,
  name: true,
  ddcCode: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { books: { where: { isActive: true } } } },
} as const;

function toCategoryResponse(category: { _count: { books: number }; [key: string]: unknown }) {
  const { _count, ...data } = category;
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
  const status = url.searchParams.get("status")?.trim() ?? "";
  const statusResult = status ? parseEnum(status, ["AKTIF", "NONAKTIF"] as const, "Status kategori") : null;
  if (statusResult && !statusResult.ok) return errorResponse(statusResult.error, 422);
  const { page, limit } = pagination.value;
  const search = searchResult.value;

  const where = {
    schoolId: auth.schoolId,
    isActive: statusResult?.ok ? statusResult.value === "AKTIF" : true,
    ...(search ? {
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { ddcCode: { contains: search, mode: "insensitive" as const } },
        { description: { contains: search, mode: "insensitive" as const } },
      ],
    } : {}),
  };

  try {
    const [categories, total] = await prisma.$transaction([
      prisma.category.findMany({
        where: { ...where, schoolId: auth.schoolId },
        select: categorySelect,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.category.count({ where: { ...where, schoolId: auth.schoolId } }),
    ]);

    return NextResponse.json({
      data: categories.map(toCategoryResponse),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }, { headers: noStoreHeaders });
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
  if (!isRecord(body) || !hasOnlyFields(body, ["name", "ddcCode", "description"])) {
    return errorResponse("Body request tidak valid.", 422);
  }

  const nameResult = parseRequiredString(body.name, { field: "Nama kategori", maxLength: 150 });
  const ddcCode = typeof body.ddcCode === "string" ? normalizeText(body.ddcCode) : "";
  const descriptionResult = parseOptionalString(body.description, { field: "Deskripsi kategori", maxLength: 1000 });
  if (!nameResult.ok || !/^\d{3}(?:\.\d{1,10})?$/.test(ddcCode) || !descriptionResult.ok) return errorResponse("Data kategori tidak valid.", 422);
  const name = nameResult.value;
  const description = descriptionResult.value ?? null;

  try {
    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.category.create({ data: { schoolId: auth.schoolId, name, ddcCode, description, isActive: true }, select: categorySelect });
      await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "CREATE", entityType: "Category", entityId: created.id, newData: jsonValue(created), ipAddress: getClientIp(request) } });
      return created;
    });
    return NextResponse.json({ data: toCategoryResponse(category) }, { status: 201, headers: noStoreHeaders });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return errorResponse("Kode DDC sudah digunakan.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
