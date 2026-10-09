import { NextResponse } from "next/server";
import argon2 from "argon2";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireLibrarian } from "@/lib/auth";
import {
  getClientIp,
  hasOnlyFields,
  isJsonContentType,
  isRecord,
  parseEnum,
  parseOptionalString,
  parsePagination,
  parseRequiredString,
  parseSearch,
} from "@/lib/validation";

export const runtime = "nodejs";

const PASSWORD_MIN_LENGTH = 12;

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

export async function GET(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return jsonError("Tidak memiliki akses.", auth.status);

  const url = new URL(request.url);
  const pagination = parsePagination(url.searchParams);
  if (!pagination.ok) return jsonError(pagination.error, 422);
  const searchResult = parseSearch(url.searchParams);
  if (!searchResult.ok) return jsonError(searchResult.error, 422);
  const { page, limit } = pagination.value;
  const search = searchResult.value;
  const className = url.searchParams.get("className")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";
  const statusResult = status ? parseEnum(status, ["AKTIF", "NONAKTIF"] as const, "Status") : null;
  if (statusResult && !statusResult.ok) return jsonError(statusResult.error, 422);

  const where = {
    schoolId: auth.schoolId,
    ...(statusResult?.ok ? { isActive: statusResult.value === "AKTIF" } : {}),
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
        where: { ...where, schoolId: auth.schoolId },
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
      prisma.student.count({ where: { ...where, schoolId: auth.schoolId } }),
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

  if (!isJsonContentType(request)) return jsonError("Content-Type harus application/json.", 415);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Body JSON tidak valid.", 400);
  }

  if (!isRecord(body) || !hasOnlyFields(body, ["username", "password", "nis", "name", "className", "libraryCardNumber", "phone"])) return jsonError("Body request tidak valid.", 422);

  const usernameResult = parseRequiredString(body.username, { field: "Username", maxLength: 100, normalize: false });
  const password = typeof body.password === "string" ? body.password : "";
  const nisResult = parseRequiredString(body.nis, { field: "NIS", maxLength: 50 });
  const nameResult = parseRequiredString(body.name, { field: "Nama", maxLength: 150 });
  const classResult = parseRequiredString(body.className, { field: "Kelas", maxLength: 100 });
  const cardResult = parseRequiredString(body.libraryCardNumber, { field: "Nomor kartu", maxLength: 100, normalize: false });
  const phoneResult = parseOptionalString(body.phone, { field: "Nomor telepon", maxLength: 30, normalize: false });

  if (!usernameResult.ok || password.length < PASSWORD_MIN_LENGTH || password.length > 256 || !nisResult.ok || !nameResult.ok || !classResult.ok || !cardResult.ok || !phoneResult.ok) return jsonError("Data anggota tidak valid.", 422);
  const username = usernameResult.value;
  const nis = nisResult.value;
  const name = nameResult.value;
  const className = classResult.value;
  const libraryCardNumber = cardResult.value;
  const phone = phoneResult.value ?? null;

  try {
    const passwordHash = await argon2.hash(password);
    const student = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { schoolId: auth.schoolId, username, passwordHash, role: "SISWA", status: "AKTIF", name },
      });
      const created = await tx.student.create({
        data: { schoolId: auth.schoolId, userId: user.id, nis, name, className, libraryCardNumber, phone },
        select: { id: true, nis: true, name: true, className: true, libraryCardNumber: true, phone: true, isActive: true, joinedAt: true, user: { select: { id: true, username: true, status: true } } },
      });
      await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "CREATE", entityType: "Student", entityId: created.id, newData: created, ipAddress: getClientIp(request) } });
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
