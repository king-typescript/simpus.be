/*
  Warnings:

  - A unique constraint covering the columns `[schoolId,fileKey]` on the table `ebooks` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[schoolId,receiptNumber]` on the table `fine_payments` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "authors" DROP CONSTRAINT "authors_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "book_copies" DROP CONSTRAINT "book_copies_bookId_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "book_copies" DROP CONSTRAINT "book_copies_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "books" DROP CONSTRAINT "books_categoryId_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "books" DROP CONSTRAINT "books_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "categories" DROP CONSTRAINT "categories_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "ebook_accesses" DROP CONSTRAINT "ebook_accesses_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "ebooks" DROP CONSTRAINT "ebooks_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "fine_payments" DROP CONSTRAINT "fine_payments_fineId_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "fine_payments" DROP CONSTRAINT "fine_payments_receivedById_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "fine_payments" DROP CONSTRAINT "fine_payments_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "fines" DROP CONSTRAINT "fines_loanItemId_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "fines" DROP CONSTRAINT "fines_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "loan_items" DROP CONSTRAINT "loan_items_copyId_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "loan_items" DROP CONSTRAINT "loan_items_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "loans" DROP CONSTRAINT "loans_processedById_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "loans" DROP CONSTRAINT "loans_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "loans" DROP CONSTRAINT "loans_studentId_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "shelves" DROP CONSTRAINT "shelves_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "students" DROP CONSTRAINT "students_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_schoolId_fkey";

-- DropIndex
DROP INDEX "audit_logs_schoolId_idx";

-- DropIndex
DROP INDEX "book_copies_schoolId_idx";

-- DropIndex
DROP INDEX "books_categoryId_idx";

-- DropIndex
DROP INDEX "ebook_accesses_schoolId_idx";

-- DropIndex
DROP INDEX "ebooks_fileKey_key";

-- DropIndex
DROP INDEX "ebooks_schoolId_idx";

-- DropIndex
DROP INDEX "fine_payments_receiptNumber_key";

-- DropIndex
DROP INDEX "fine_payments_schoolId_idx";

-- DropIndex
DROP INDEX "fines_schoolId_idx";

-- DropIndex
DROP INDEX "loan_items_schoolId_idx";

-- DropIndex
DROP INDEX "loans_schoolId_idx";

-- DropIndex
DROP INDEX "users_role_idx";

-- AlterTable
ALTER TABLE "book_copies" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "book_copies_schoolId_status_idx" ON "book_copies"("schoolId", "status");

-- CreateIndex
CREATE INDEX "book_copies_isActive_idx" ON "book_copies"("isActive");

-- CreateIndex
CREATE INDEX "books_schoolId_categoryId_idx" ON "books"("schoolId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ebooks_schoolId_fileKey_key" ON "ebooks"("schoolId", "fileKey");

-- CreateIndex
CREATE UNIQUE INDEX "fine_payments_schoolId_receiptNumber_key" ON "fine_payments"("schoolId", "receiptNumber");

-- CreateIndex
CREATE INDEX "fines_schoolId_status_idx" ON "fines"("schoolId", "status");

-- CreateIndex
CREATE INDEX "loans_schoolId_status_idx" ON "loans"("schoolId", "status");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authors" ADD CONSTRAINT "authors_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_categoryId_schoolId_fkey" FOREIGN KEY ("categoryId", "schoolId") REFERENCES "categories"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebook_accesses" ADD CONSTRAINT "ebook_accesses_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelves" ADD CONSTRAINT "shelves_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_bookId_schoolId_fkey" FOREIGN KEY ("bookId", "schoolId") REFERENCES "books"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "students"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_processedById_schoolId_fkey" FOREIGN KEY ("processedById", "schoolId") REFERENCES "users"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_items" ADD CONSTRAINT "loan_items_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_items" ADD CONSTRAINT "loan_items_copyId_schoolId_fkey" FOREIGN KEY ("copyId", "schoolId") REFERENCES "book_copies"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_loanItemId_schoolId_fkey" FOREIGN KEY ("loanItemId", "schoolId") REFERENCES "loan_items"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fine_payments" ADD CONSTRAINT "fine_payments_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fine_payments" ADD CONSTRAINT "fine_payments_fineId_schoolId_fkey" FOREIGN KEY ("fineId", "schoolId") REFERENCES "fines"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fine_payments" ADD CONSTRAINT "fine_payments_receivedById_schoolId_fkey" FOREIGN KEY ("receivedById", "schoolId") REFERENCES "users"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
