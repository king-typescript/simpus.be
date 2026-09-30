import { NextResponse } from "next/server";
import argon2 from "argon2";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireLibrarian } from "@/lib/auth";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const PASSWORD_MIN_LENGTH = 12;

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return jsonError("Tidak memiliki akses.", auth.status);

  const url = new URL(request.url);
  const page = positiveInteger(url.searchParams.get("page"), 1);
  const limit = Math.min(
    positiveInteger(url.searchParams.get("limit"), DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const search = url.searchParams.get("search")?.trim() ?? "";
  const className = url.searchParams.get("className")?.trim() ?? "";
  const status = url.searchParams.get("status");

  if (status && status !== "AKTIF" && status !== "NONAKTIF") {
    return jsonError("Status tidak valid.", 422);
  }

  const where = {
    ...(status ? { isActive: status === "AKTIF" } : {}),
    ...(className ? { className: { contains: className, mode: "insensitive" as const } } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { nis: { contains: search, mode: "insensitive" as const } },
            { libraryCardNumber: { contains: search, mode: "insensitive" as const } },
            { user: { username: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  try {
    const [data, total] = await prisma.$transaction([
      prisma.student.findMany({
        where,
        select: {
          id: true,
          nis: true,
          name: true,
          className: true,
          libraryCardNumber: true,
          phone: true,
          isActive: true,
          joinedAt: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, username: true, status: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.student.count({ where }),
    ]);

    return NextResponse.json(
      { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } },
      { headers: noStoreHeaders },
    );
  } catch {
    return jsonError("Terjadi kesalahan pada server.", 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return jsonError("Tidak memiliki akses.", auth.status);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Body JSON tidak valid.", 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError("Body request tidak valid.", 422);
  }

  const input = body as Record<string, unknown>;
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const nis = typeof input.nis === "string" ? input.nis.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const className = typeof input.className === "string" ? input.className.trim() : "";
  const libraryCardNumber = typeof input.libraryCardNumber === "string" ? input.libraryCardNumber.trim() : "";
  const phone = input.phone === null || typeof input.phone === "string" ? input.phone?.trim() || null : undefined;

  if (
    !username || username.length > 100 || password.length < PASSWORD_MIN_LENGTH || password.length > 256 ||
    !nis || nis.length > 50 || !name || name.length > 150 || !className || className.length > 100 ||
    !libraryCardNumber || libraryCardNumber.length > 100 || phone === undefined
  ) {
    return jsonError("Data anggota tidak valid.", 422);
  }

  try {
    const passwordHash = await argon2.hash(password);
    const student = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { username, passwordHash, role: "SISWA", status: "AKTIF", name },
      });
      const created = await tx.student.create({
        data: { userId: user.id, nis, name, className, libraryCardNumber, phone },
        select: { id: true, nis: true, name: true, className: true, libraryCardNumber: true, phone: true, isActive: true, joinedAt: true, user: { select: { id: true, username: true, status: true } } },
      });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "CREATE", entityType: "Student", entityId: created.id, newData: created } });
      return created;
    });
    return NextResponse.json({ data: student }, { status: 201, headers: noStoreHeaders });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return jsonError("Username, NIS, atau nomor kartu sudah digunakan.", 409);
    }
    return jsonError("Terjadi kesalahan pada server.", 500);
  }
}
