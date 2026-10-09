import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireLibrarian } from "@/lib/auth";
import {
  getClientIp,
  hasOnlyFields,
  isJsonContentType,
  isRecord,
  isUuid,
  parseOptionalString,
  parseRequiredString,
} from "@/lib/validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

const selectStudent = {
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
} as const;

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return jsonError("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!isUuid(id)) return jsonError("ID anggota tidak valid.", 422);

  try {
    const data = await prisma.student.findUnique({ where: { id, schoolId: auth.schoolId }, select: selectStudent });
    return data ? NextResponse.json({ data }, { headers: noStoreHeaders }) : jsonError("Anggota tidak ditemukan.", 404);
  } catch {
    return jsonError("Terjadi kesalahan pada server.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return jsonError("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!isUuid(id)) return jsonError("ID anggota tidak valid.", 422);

  if (!isJsonContentType(request)) return jsonError("Content-Type harus application/json.", 415);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Body JSON tidak valid.", 400); }
  if (!isRecord(body) || !hasOnlyFields(body, ["nis", "name", "className", "libraryCardNumber", "phone"])) return jsonError("Body request tidak valid.", 422);

  const data: { nis?: string; name?: string; className?: string; libraryCardNumber?: string; phone?: string | null } = {};
  for (const field of ["nis", "name", "className", "libraryCardNumber"] as const) {
    if (field in body) {
      const result = parseRequiredString(body[field], { field, maxLength: field === "nis" ? 50 : field === "name" ? 150 : field === "className" ? 100 : 100 });
      if (!result.ok) return jsonError(result.error, 422);
      data[field] = result.value;
    }
  }
  if ("phone" in body) {
    const result = parseOptionalString(body.phone, { field: "Nomor telepon", maxLength: 30, normalize: false });
    if (!result.ok) return jsonError(result.error, 422);
    data.phone = result.value ?? null;
  }
  if (!Object.keys(data).length) return jsonError("Tidak ada perubahan.", 422);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.student.findUnique({ where: { id, schoolId: auth.schoolId }, select: { ...selectStudent, userId: true } });
      if (!current) return null;
      const student = await tx.student.update({ where: { id, schoolId: auth.schoolId }, data, select: selectStudent });
      if (data.name !== undefined) await tx.user.update({ where: { id: current.userId, schoolId: auth.schoolId }, data: { name: data.name } });
      await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "UPDATE", entityType: "Student", entityId: id, oldData: jsonValue(current), newData: jsonValue(student), ipAddress: getClientIp(request) } });
      return student;
    });
    return updated ? NextResponse.json({ data: updated }, { headers: noStoreHeaders }) : jsonError("Anggota tidak ditemukan.", 404);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return jsonError("NIS atau nomor kartu sudah digunakan.", 409);
    return jsonError("Terjadi kesalahan pada server.", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return jsonError("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!isUuid(id)) return jsonError("ID anggota tidak valid.", 422);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id, schoolId: auth.schoolId }, select: selectStudent });
      if (!student) return false;
      const userId = student.user.id;
      await tx.student.update({ where: { id, schoolId: auth.schoolId }, data: { isActive: false } });
      await tx.user.update({ where: { id: userId, schoolId: auth.schoolId }, data: { status: "NONAKTIF" } });
      await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "DEACTIVATE", entityType: "Student", entityId: id, oldData: jsonValue(student), newData: jsonValue({ ...student, isActive: false }), ipAddress: getClientIp(request) } });
      return true;
    });
    return result ? new NextResponse(null, { status: 204 }) : jsonError("Anggota tidak ditemukan.", 404);
  } catch {
    return jsonError("Terjadi kesalahan pada server.", 500);
  }
}
