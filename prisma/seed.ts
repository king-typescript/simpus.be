import "dotenv/config";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} belum diatur.`);
  }

  return value;
}

if (process.env.NODE_ENV === "production") {
  throw new Error("Seed tidak boleh dijalankan pada production.");
}

const databaseUrl = requiredEnv("DATABASE_URL");
const adminPassword = requiredEnv("SEED_ADMIN_PASSWORD");
const studentPassword = requiredEnv("SEED_STUDENT_PASSWORD");

if (adminPassword.length < 12) {
  throw new Error("SEED_ADMIN_PASSWORD minimal 12 karakter.");
}

if (studentPassword.length < 12) {
  throw new Error("SEED_STUDENT_PASSWORD minimal 12 karakter.");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  const [adminPasswordHash, studentPasswordHash] = await Promise.all([
    argon2.hash(adminPassword),
    argon2.hash(studentPassword),
  ]);

  await prisma.$transaction(async (tx) => {
    await tx.librarySetting.upsert({
      where: { key: "DEFAULT" },
      update: {},
      create: {
        key: "DEFAULT",
        maxLoanDays: 7,
        maxActiveCopies: 3,
        fineRatePerDay: "1000.00",
      },
    });

    const librarian = await tx.user.upsert({
      where: { username: "admin" },
      update: {
        role: "PUSTAKAWAN",
        status: "AKTIF",
        name: "Administrator Perpustakaan",
      },
      create: {
        username: "admin",
        passwordHash: adminPasswordHash,
        role: "PUSTAKAWAN",
        status: "AKTIF",
        name: "Administrator Perpustakaan",
      },
    });

    const studentUser = await tx.user.upsert({
      where: { username: "siswa001" },
      update: {
        role: "SISWA",
        status: "AKTIF",
        name: "Budi Santoso",
      },
      create: {
        username: "siswa001",
        passwordHash: studentPasswordHash,
        role: "SISWA",
        status: "AKTIF",
        name: "Budi Santoso",
      },
    });

    const student = await tx.student.upsert({
      where: { userId: studentUser.id },
      update: {
        nis: "20260001",
        name: "Budi Santoso",
        className: "XII IPA 1",
        libraryCardNumber: "KARTU-0001",
        phone: "081234567890",
        isActive: true,
      },
      create: {
        userId: studentUser.id,
        nis: "20260001",
        name: "Budi Santoso",
        className: "XII IPA 1",
        libraryCardNumber: "KARTU-0001",
        phone: "081234567890",
        isActive: true,
      },
    });

    const category = await tx.category.upsert({
      where: { ddcCode: "000" },
      update: {
        name: "Karya Umum",
        description: "Pengetahuan umum dan komputer.",
      },
      create: {
        name: "Karya Umum",
        ddcCode: "000",
        description: "Pengetahuan umum dan komputer.",
      },
    });

    const shelf = await tx.shelf.upsert({
      where: { code: "RAK-A1" },
      update: {
        name: "Rak A1",
        location: "Ruang Utama",
      },
      create: {
        code: "RAK-A1",
        name: "Rak A1",
        location: "Ruang Utama",
      },
    });

    const existingAuthor = await tx.author.findFirst({
      where: { name: "Tere Liye" },
    });

    const author =
      existingAuthor ??
      (await tx.author.create({
        data: { name: "Tere Liye" },
      }));

    const book = await tx.book.upsert({
      where: { isbn: "9786020338682" },
      update: {
        title: "Bumi",
        publisher: "Gramedia Pustaka Utama",
        publicationYear: 2014,
        categoryId: category.id,
      },
      create: {
        isbn: "9786020338682",
        title: "Bumi",
        publisher: "Gramedia Pustaka Utama",
        publicationYear: 2014,
        categoryId: category.id,
        authors: {
          connect: { id: author.id },
        },
      },
    });

    await tx.book.update({
      where: { id: book.id },
      data: {
        authors: {
          connect: { id: author.id },
        },
      },
    });

    const existingBookCopy = await tx.bookCopy.findUnique({
      where: { barcode: "BC-000001" },
    });

    const bookCopy =
      existingBookCopy ??
      (await tx.bookCopy.create({
        data: {
          bookId: book.id,
          shelfId: shelf.id,
          barcode: "BC-000001",
          status: "TERSEDIA",
          conditionNote: "Baik",
          acquiredAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      }));

    console.table({
      librarianId: librarian.id,
      studentUserId: studentUser.id,
      studentId: student.id,
      categoryId: category.id,
      authorId: author.id,
      bookId: book.id,
      bookCopyId: bookCopy.id,
    });
  });

  console.log("Seed berhasil.");
}

main()
  .catch((error) => {
    console.error("Seed gagal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
