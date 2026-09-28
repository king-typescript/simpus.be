import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireLibrarian } from "@/lib/auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

function validId(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
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
  if (!validId(id)) return jsonError("ID anggota tidak valid.", 422);

  try {
    const data = await prisma.student.findUnique({ where: { id }, select: selectStudent });
    return data ? NextResponse.json({ data }, { headers: noStoreHeaders }) : jsonError("Anggota tidak ditemukan.", 404);
  } catch {
    return jsonError("Terjadi kesalahan pada server.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return jsonError("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!validId(id)) return jsonError("ID anggota tidak valid.", 422);

  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Body JSON tidak valid.", 400); }
  if (typeof body !== "object" || body === null) return jsonError("Body request tidak valid.", 422);

  const input = body as Record<string, unknown>;
  const data: { nis?: string; name?: string; className?: string; libraryCardNumber?: string; phone?: string | null } = {};
  for (const field of ["nis", "name", "className", "libraryCardNumber"] as const) {
    if (field in input) {
      if (typeof input[field] !== "string" || !input[field].trim()) return jsonError("Data anggota tidak valid.", 422);
      data[field] = input[field].trim();
    }
  }
  if ("phone" in input) {
    if (input.phone !== null && typeof input.phone !== "string") return jsonError("Nomor telepon tidak valid.", 422);
    data.phone = typeof input.phone === "string" ? input.phone.trim() || null : null;
  }
  if (!Object.keys(data).length) return jsonError("Tidak ada perubahan.", 422);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.student.findUnique({ where: { id }, select: { userId: true } });
      if (!current) return null;
      const student = await tx.student.update({ where: { id }, data, select: selectStudent });
      if (data.name !== undefined) await tx.user.update({ where: { id: current.userId }, data: { name: data.name } });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "UPDATE", entityType: "Student", entityId: id, newData: student } });
      return student;
    });
    return updated ? NextResponse.json({ data: updated }, { headers: noStoreHeaders }) : jsonError("Anggota tidak ditemukan.", 404);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return jsonError("NIS atau nomor kartu sudah digunakan.", 409);
    return jsonError("Terjadi kesalahan pada server.", 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return jsonError("Tidak memiliki akses.", auth.status);
  const { id } = await context.params;
  if (!validId(id)) return jsonError("ID anggota tidak valid.", 422);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id }, select: { userId: true } });
      if (!student) return false;
      await tx.student.update({ where: { id }, data: { isActive: false } });
      await tx.user.update({ where: { id: student.userId }, data: { status: "NONAKTIF" } });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "DEACTIVATE", entityType: "Student", entityId: id } });
      return true;
    });
    return result ? new NextResponse(null, { status: 204 }) : jsonError("Anggota tidak ditemukan.", 404);
  } catch {
    return jsonError("Terjadi kesalahan pada server.", 500);
  }
}
