import "dotenv/config";

import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const MIN_PASSWORD_LENGTH = 16;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function required(name: string, value: string | undefined): string {
  const result = value?.trim();
  if (!result) throw new Error(`${name} wajib diisi.`);
  return result;
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function validateInput(code: string, name: string, username: string, librarianName: string) {
  if (!CODE_PATTERN.test(code)) throw new Error("schoolCode harus 2-32 karakter: huruf kapital, angka, _, atau -.");
  if (name.length > 150) throw new Error("schoolName maksimal 150 karakter.");
  if (!USERNAME_PATTERN.test(username)) throw new Error("username harus 3-32 karakter lowercase.");
  if (librarianName.length > 150) throw new Error("librarianName maksimal 150 karakter.");
}

function generateTemporaryPassword(): string {
  return randomBytes(18).toString("base64url").slice(0, MIN_PASSWORD_LENGTH);
}

const code = required("--school-code", readOption("school-code")).toUpperCase();
const name = required("--school-name", readOption("school-name"));
const username = required("--username", readOption("username")).toLowerCase();
const librarianName = required("--librarian-name", readOption("librarian-name"));
validateInput(code, name, username, librarianName);

const temporaryPassword = generateTemporaryPassword();
const passwordHash = await argon2.hash(temporaryPassword);

try {
  const result = await prisma.$transaction(async (tx) => {
    const existingSchool = await tx.school.findUnique({ where: { code }, select: { id: true } });
    if (existingSchool) throw new Error("SCHOOL_CODE_EXISTS");

    const school = await tx.school.create({
      data: { code, name, isActive: true },
      select: { id: true, code: true, name: true },
    });

    await tx.librarySetting.create({
      data: {
        schoolId: school.id,
        maxLoanDays: 7,
        maxActiveCopies: 3,
        fineRatePerDay: "0.00",
      },
    });

    const librarian = await tx.user.create({
      data: {
        schoolId: school.id,
        username,
        passwordHash,
        role: "PUSTAKAWAN",
        status: "AKTIF",
        mustChangePassword: true,
        name: librarianName,
      },
      select: { id: true, username: true, name: true },
    });

    await tx.auditLog.create({
      data: {
        schoolId: school.id,
        userId: librarian.id,
        action: "PROVISION",
        entityType: "School",
        entityId: school.id,
        newData: {
          schoolCode: school.code,
          schoolName: school.name,
          librarianId: librarian.id,
          librarianUsername: librarian.username,
          role: "PUSTAKAWAN",
        },
      },
    });

    return { school, librarian };
  });

  console.log(`Sekolah berhasil dibuat: ${result.school.code} (${result.school.name})`);
  console.log(`Username pustakawan: ${result.librarian.username}`);
  console.log(`Password sementara: ${temporaryPassword}`);
  console.log("Simpan password ini sekarang. Password tidak dapat ditampilkan ulang.");
} catch (error) {
  if (error instanceof Error && error.message === "SCHOOL_CODE_EXISTS") {
    throw new Error("Kode sekolah sudah digunakan.");
  }
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
    throw new Error("Username pustakawan sudah digunakan pada sekolah tersebut.");
  }
  throw error;
} finally {
  await prisma.$disconnect();
}
