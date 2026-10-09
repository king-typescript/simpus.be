import "dotenv/config";

import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma";

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value) throw new Error(`--${name} wajib diisi.`);
  return value;
}

const schoolCode = option("school-code").toUpperCase();
const username = option("username").toLowerCase();
const password = randomBytes(18).toString("base64url").slice(0, 16);
const passwordHash = await argon2.hash(password);

try {
  const result = await prisma.$transaction(async (tx) => {
    const school = await tx.school.findUnique({ where: { code: schoolCode }, select: { id: true, code: true } });
    if (!school) throw new Error("SCHOOL_NOT_FOUND");

    const user = await tx.user.findUnique({
      where: { schoolId_username: { schoolId: school.id, username } },
      select: { id: true, username: true, role: true },
    });
    if (!user) throw new Error("USER_NOT_FOUND");
    if (user.role !== "PUSTAKAWAN") throw new Error("NOT_LIBRARIAN");

    const updated = await tx.user.update({
      where: { id: user.id, schoolId: school.id },
      data: { passwordHash, mustChangePassword: true, status: "AKTIF" },
      select: { id: true, username: true },
    });

    await tx.auditLog.create({
      data: {
        schoolId: school.id,
        userId: user.id,
        action: "RESET_PASSWORD",
        entityType: "User",
        entityId: user.id,
        newData: { username: user.username, mustChangePassword: true },
      },
    });

    return { school, user: updated };
  });

  console.log(`Password direset: ${result.school.code}/${result.user.username}`);
  console.log(`Password sementara: ${password}`);
  console.log("Simpan password ini sekarang. Password tidak dapat ditampilkan ulang.");
} catch (error) {
  if (error instanceof Error) {
    if (error.message === "SCHOOL_NOT_FOUND") throw new Error("Sekolah tidak ditemukan.");
    if (error.message === "USER_NOT_FOUND") throw new Error("User tidak ditemukan.");
    if (error.message === "NOT_LIBRARIAN") throw new Error("User bukan pustakawan.");
  }
  throw error;
} finally {
  await prisma.$disconnect();
}
