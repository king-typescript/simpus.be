import "dotenv/config";

import { prisma } from "../lib/prisma";

type RequestedStatus = "AKTIF" | "NONAKTIF";

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value) throw new Error(`--${name} wajib diisi.`);
  return value;
}

const schoolCode = option("school-code").toUpperCase();
const username = option("username").toLowerCase();
const rawStatus = option("status").toLowerCase();
const status: RequestedStatus = rawStatus === "active"
  ? "AKTIF"
  : rawStatus === "inactive"
    ? "NONAKTIF"
    : (() => { throw new Error("--status harus active atau inactive."); })();

try {
  const result = await prisma.$transaction(async (tx) => {
    const school = await tx.school.findUnique({ where: { code: schoolCode }, select: { id: true, code: true } });
    if (!school) throw new Error("SCHOOL_NOT_FOUND");

    const user = await tx.user.findUnique({
      where: { schoolId_username: { schoolId: school.id, username } },
      select: { id: true, username: true, role: true, status: true },
    });
    if (!user) throw new Error("USER_NOT_FOUND");
    if (user.role !== "PUSTAKAWAN") throw new Error("NOT_LIBRARIAN");
    if (user.status === status) throw new Error("STATUS_UNCHANGED");

    if (status === "NONAKTIF") {
      const activeLibrarians = await tx.user.count({
        where: { schoolId: school.id, role: "PUSTAKAWAN", status: "AKTIF" },
      });
      if (activeLibrarians <= 1) throw new Error("LAST_ACTIVE_LIBRARIAN");
    }

    const updated = await tx.user.update({
      where: { id: user.id, schoolId: school.id },
      data: { status },
      select: { username: true, status: true },
    });

    await tx.auditLog.create({
      data: {
        schoolId: school.id,
        userId: user.id,
        action: status === "AKTIF" ? "ACTIVATE_USER" : "DEACTIVATE_USER",
        entityType: "User",
        entityId: user.id,
        oldData: { status: user.status },
        newData: { status: updated.status, username: updated.username },
      },
    });

    return { school, updated };
  });

  console.log(`Status pustakawan ${result.school.code}/${result.updated.username}: ${result.updated.status}`);
} catch (error) {
  if (error instanceof Error) {
    const messages: Record<string, string> = {
      SCHOOL_NOT_FOUND: "Sekolah tidak ditemukan.",
      USER_NOT_FOUND: "User tidak ditemukan.",
      NOT_LIBRARIAN: "User bukan pustakawan.",
      STATUS_UNCHANGED: "Status user sudah sesuai.",
      LAST_ACTIVE_LIBRARIAN: "Pustakawan aktif terakhir tidak boleh dinonaktifkan.",
    };
    if (messages[error.message]) throw new Error(messages[error.message]);
  }
  throw error;
} finally {
  await prisma.$disconnect();
}
