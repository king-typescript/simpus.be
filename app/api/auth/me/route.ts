import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser } from "@/lib/auth";

export const runtime = "nodejs";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders });
}

const studentSelect = {
  id: true,
  userId: true,
  schoolId: true,
  nis: true,
  name: true,
  className: true,
  libraryCardNumber: true,
  phone: true,
  isActive: true,
} as const;

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    if (auth.status === 403 && "code" in auth && auth.code === "PASSWORD_CHANGE_REQUIRED") {
      return NextResponse.json(
        { error: "Password harus diubah sebelum melanjutkan.", code: auth.code },
        { status: auth.status, headers: noStoreHeaders },
      );
    }
    return errorResponse("Autentikasi diperlukan.", auth.status);
  }

  try {
    const student = auth.user.role === "SISWA"
      ? await prisma.student.findFirst({
          where: {
            userId: auth.user.id,
            schoolId: auth.user.schoolId,
            isActive: true,
          },
          select: studentSelect,
        })
      : null;

    if (auth.user.role === "SISWA" && !student) {
      return errorResponse("Profil siswa tidak ditemukan.", 403);
    }

    return NextResponse.json(
      {
        user: {
          id: auth.user.id,
          schoolId: auth.user.schoolId,
          username: auth.user.username,
          name: auth.user.name,
          role: auth.user.role,
          status: auth.user.status,
          mustChangePassword: auth.user.mustChangePassword,
        },
        school: auth.user.school,
        student,
      },
      { headers: noStoreHeaders },
    );
  } catch {
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
