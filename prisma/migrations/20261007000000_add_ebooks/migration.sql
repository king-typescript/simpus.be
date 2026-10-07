-- CreateEnum
CREATE TYPE "EbookStatus" AS ENUM ('AKTIF', 'NONAKTIF');

-- CreateEnum
CREATE TYPE "EbookAccessStatus" AS ENUM ('AKTIF', 'DIKEMBALIKAN', 'KEDALUWARSA');

-- CreateTable
CREATE TABLE "ebooks" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "status" "EbookStatus" NOT NULL DEFAULT 'AKTIF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ebooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebook_accesses" (
    "id" TEXT NOT NULL,
    "ebookId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    "extensionCount" INTEGER NOT NULL DEFAULT 0,
    "status" "EbookAccessStatus" NOT NULL DEFAULT 'AKTIF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ebook_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ebooks_bookId_key" ON "ebooks"("bookId");
CREATE UNIQUE INDEX "ebooks_fileKey_key" ON "ebooks"("fileKey");
CREATE INDEX "ebooks_status_idx" ON "ebooks"("status");
CREATE UNIQUE INDEX "ebook_accesses_accessTokenHash_key" ON "ebook_accesses"("accessTokenHash");
CREATE INDEX "ebook_accesses_studentId_status_idx" ON "ebook_accesses"("studentId", "status");
CREATE INDEX "ebook_accesses_ebookId_status_idx" ON "ebook_accesses"("ebookId", "status");
CREATE INDEX "ebook_accesses_expiresAt_idx" ON "ebook_accesses"("expiresAt");
CREATE UNIQUE INDEX "ebook_accesses_one_active_per_student" ON "ebook_accesses"("ebookId", "studentId") WHERE "status" = 'AKTIF';

-- AddForeignKey
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ebook_accesses" ADD CONSTRAINT "ebook_accesses_ebookId_fkey" FOREIGN KEY ("ebookId") REFERENCES "ebooks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ebook_accesses" ADD CONSTRAINT "ebook_accesses_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
