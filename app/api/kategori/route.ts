import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_PAGE = 10_000;

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function hasOnlyFields(value: Record<string, unknown>, fields: readonly string[]) {
  return Object.keys(value).every((key) => fields.includes(key));
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
  const page = isPositiveInteger(url.searchParams.get("page"), 1, MAX_PAGE);
  const limit = isPositiveInteger(url.searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";

  if (status && status !== "AKTIF" && status !== "NONAKTIF") {
    return errorResponse("Status kategori tidak valid.", 422);
  }

  const where = {
    isActive: status ? status === "AKTIF" : true,
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
        where,
        select: categorySelect,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.category.count({ where }),
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

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("Body JSON tidak valid.", 400); }
  if (!isRecord(body) || !hasOnlyFields(body, ["name", "ddcCode", "description"])) {
    return errorResponse("Body request tidak valid.", 422);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const ddcCode = typeof body.ddcCode === "string" ? body.ddcCode.trim() : "";
  const description = body.description === null || body.description === undefined
    ? null
    : typeof body.description === "string" ? body.description.trim() || null : undefined;

  if (!name || name.length > 150 || ddcCode.length > 20 || !/^\d{3}(?:\.\d{1,10})?$/.test(ddcCode) || description === undefined || (description !== null && description.length > 1000)) {
    return errorResponse("Data kategori tidak valid.", 422);
  }

  try {
    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.category.create({ data: { name, ddcCode, description, isActive: true }, select: categorySelect });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "CREATE", entityType: "Category", entityId: created.id, newData: jsonValue(created) } });
      return created;
    });
    return NextResponse.json({ data: toCategoryResponse(category) }, { status: 201, headers: noStoreHeaders });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return errorResponse("Kode DDC sudah digunakan.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
