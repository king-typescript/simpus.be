import "dotenv/config";

import { prisma } from "../lib/prisma";

type RequestedStatus = "ACTIVE" | "INACTIVE";

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value) throw new Error(`--${name} wajib diisi.`);
  return value;
}

const code = option("school-code").toUpperCase();
const rawStatus = option("status").toLowerCase();
const status: RequestedStatus = rawStatus === "active"
  ? "ACTIVE"
  : rawStatus === "inactive"
    ? "INACTIVE"
    : (() => { throw new Error("--status harus active atau inactive."); })();

try {
  const result = await prisma.$transaction(async (tx) => {
    const school = await tx.school.findUnique({ where: { code }, select: { id: true, code: true, isActive: true } });
    if (!school) throw new Error("SCHOOL_NOT_FOUND");

    const isActive = status === "ACTIVE";
    if (school.isActive === isActive) throw new Error("STATUS_UNCHANGED");

    const updated = await tx.school.update({
      where: { id: school.id },
      data: { isActive },
      select: { code: true, isActive: true },
    });

    await tx.auditLog.create({
      data: {
        schoolId: school.id,
        action: isActive ? "ACTIVATE_SCHOOL" : "DEACTIVATE_SCHOOL",
        entityType: "School",
        entityId: school.id,
        oldData: { isActive: school.isActive },
        newData: { isActive: updated.isActive, code: updated.code },
      },
    });

    return updated;
  });

  console.log(`Status sekolah ${result.code}: ${result.isActive ? "AKTIF" : "NONAKTIF"}`);
} catch (error) {
  if (error instanceof Error) {
    if (error.message === "SCHOOL_NOT_FOUND") throw new Error("Sekolah tidak ditemukan.");
    if (error.message === "STATUS_UNCHANGED") throw new Error("Status sekolah sudah sesuai.");
  }
  throw error;
} finally {
  await prisma.$disconnect();
}
