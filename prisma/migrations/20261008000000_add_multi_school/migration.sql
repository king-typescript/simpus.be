-- Add school tenancy while preserving existing data in DEFAULT school.
CREATE TABLE "schools" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "logoUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "schools_code_key" ON "schools"("code");

INSERT INTO "schools" ("id", "code", "name", "updatedAt")
VALUES (gen_random_uuid()::text, 'DEFAULT', 'Sekolah Default', CURRENT_TIMESTAMP);

ALTER TABLE "library_settings" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "users" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "students" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "authors" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "categories" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "books" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "ebooks" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "ebook_accesses" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "shelves" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "book_copies" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "loans" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "loan_items" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "fines" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "fine_payments" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "schoolId" TEXT;

UPDATE "library_settings" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');
UPDATE "users" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');
UPDATE "students" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');
UPDATE "authors" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');
UPDATE "categories" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');
UPDATE "books" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');
UPDATE "ebooks" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');
UPDATE "ebook_accesses" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');
UPDATE "shelves" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');
UPDATE "book_copies" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');
UPDATE "loans" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');
UPDATE "loan_items" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');
UPDATE "fines" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');
UPDATE "fine_payments" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');
UPDATE "audit_logs" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "code" = 'DEFAULT');

ALTER TABLE "library_settings" DROP COLUMN "key";
ALTER TABLE "library_settings" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "students" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "authors" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "categories" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "books" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "ebooks" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "ebook_accesses" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "shelves" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "book_copies" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "loans" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "loan_items" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "fines" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "fine_payments" ALTER COLUMN "schoolId" SET NOT NULL;

DROP INDEX IF EXISTS "library_settings_key_key";
DROP INDEX IF EXISTS "users_username_key";
DROP INDEX IF EXISTS "students_nis_key";
DROP INDEX IF EXISTS "students_libraryCardNumber_key";
DROP INDEX IF EXISTS "categories_ddcCode_key";
DROP INDEX IF EXISTS "books_isbn_key";
DROP INDEX IF EXISTS "shelves_code_key";
DROP INDEX IF EXISTS "book_copies_barcode_key";

CREATE UNIQUE INDEX "library_settings_schoolId_key" ON "library_settings"("schoolId");
CREATE UNIQUE INDEX "users_schoolId_username_key" ON "users"("schoolId", "username");
CREATE UNIQUE INDEX "students_schoolId_nis_key" ON "students"("schoolId", "nis");
CREATE UNIQUE INDEX "students_schoolId_libraryCardNumber_key" ON "students"("schoolId", "libraryCardNumber");
CREATE UNIQUE INDEX "categories_schoolId_ddcCode_key" ON "categories"("schoolId", "ddcCode");
CREATE UNIQUE INDEX "books_schoolId_isbn_key" ON "books"("schoolId", "isbn");
CREATE UNIQUE INDEX "shelves_schoolId_code_key" ON "shelves"("schoolId", "code");
CREATE UNIQUE INDEX "book_copies_schoolId_barcode_key" ON "book_copies"("schoolId", "barcode");
CREATE INDEX "users_schoolId_role_idx" ON "users"("schoolId", "role");
CREATE INDEX "students_schoolId_idx" ON "students"("schoolId");
CREATE INDEX "authors_schoolId_idx" ON "authors"("schoolId");
CREATE INDEX "categories_schoolId_idx" ON "categories"("schoolId");
CREATE INDEX "books_schoolId_idx" ON "books"("schoolId");
CREATE INDEX "ebooks_schoolId_idx" ON "ebooks"("schoolId");
CREATE INDEX "ebook_accesses_schoolId_idx" ON "ebook_accesses"("schoolId");
CREATE INDEX "shelves_schoolId_idx" ON "shelves"("schoolId");
CREATE INDEX "book_copies_schoolId_idx" ON "book_copies"("schoolId");
CREATE INDEX "loans_schoolId_idx" ON "loans"("schoolId");
CREATE INDEX "loan_items_schoolId_idx" ON "loan_items"("schoolId");
CREATE INDEX "fines_schoolId_idx" ON "fines"("schoolId");
CREATE INDEX "fine_payments_schoolId_idx" ON "fine_payments"("schoolId");
CREATE INDEX "audit_logs_schoolId_idx" ON "audit_logs"("schoolId");

ALTER TABLE "library_settings" ADD CONSTRAINT "library_settings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON UPDATE CASCADE;
ALTER TABLE "students" ADD CONSTRAINT "students_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON UPDATE CASCADE;
ALTER TABLE "authors" ADD CONSTRAINT "authors_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON UPDATE CASCADE;
ALTER TABLE "books" ADD CONSTRAINT "books_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON UPDATE CASCADE;
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON UPDATE CASCADE;
ALTER TABLE "ebook_accesses" ADD CONSTRAINT "ebook_accesses_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON UPDATE CASCADE;
ALTER TABLE "shelves" ADD CONSTRAINT "shelves_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON UPDATE CASCADE;
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON UPDATE CASCADE;
ALTER TABLE "loans" ADD CONSTRAINT "loans_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON UPDATE CASCADE;
ALTER TABLE "loan_items" ADD CONSTRAINT "loan_items_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON UPDATE CASCADE;
ALTER TABLE "fines" ADD CONSTRAINT "fines_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON UPDATE CASCADE;
ALTER TABLE "fine_payments" ADD CONSTRAINT "fine_payments_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
