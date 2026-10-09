-- Same-school enforcement via composite foreign keys.
-- Child table schoolId must match parent table schoolId at DB level.

-- Step 1: Composite unique indexes on (id, schoolId) for parent tables.
CREATE UNIQUE INDEX IF NOT EXISTS "users_id_schoolId_key" ON "users"("id", "schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "students_id_schoolId_key" ON "students"("id", "schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "categories_id_schoolId_key" ON "categories"("id", "schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "books_id_schoolId_key" ON "books"("id", "schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "ebooks_id_schoolId_key" ON "ebooks"("id", "schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "shelves_id_schoolId_key" ON "shelves"("id", "schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "book_copies_id_schoolId_key" ON "book_copies"("id", "schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "loans_id_schoolId_key" ON "loans"("id", "schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "loan_items_id_schoolId_key" ON "loan_items"("id", "schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "fines_id_schoolId_key" ON "fines"("id", "schoolId");

-- Step 2: Composite unique indexes for one-to-one child relations.
CREATE UNIQUE INDEX IF NOT EXISTS "ebooks_bookId_schoolId_key" ON "ebooks"("bookId", "schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "fines_loanItemId_schoolId_key" ON "fines"("loanItemId", "schoolId");
CREATE UNIQUE INDEX IF NOT EXISTS "fine_payments_fineId_schoolId_key" ON "fine_payments"("fineId", "schoolId");

-- Step 3: Drop existing single-column FKs that will be replaced.
ALTER TABLE "books" DROP CONSTRAINT IF EXISTS "books_categoryId_fkey";
ALTER TABLE "ebooks" DROP CONSTRAINT IF EXISTS "ebooks_bookId_fkey";
ALTER TABLE "ebook_accesses" DROP CONSTRAINT IF EXISTS "ebook_accesses_ebookId_fkey";
ALTER TABLE "ebook_accesses" DROP CONSTRAINT IF EXISTS "ebook_accesses_studentId_fkey";
ALTER TABLE "book_copies" DROP CONSTRAINT IF EXISTS "book_copies_bookId_fkey";
ALTER TABLE "book_copies" DROP CONSTRAINT IF EXISTS "book_copies_shelfId_fkey";
ALTER TABLE "loans" DROP CONSTRAINT IF EXISTS "loans_studentId_fkey";
ALTER TABLE "loans" DROP CONSTRAINT IF EXISTS "loans_processedById_fkey";
ALTER TABLE "loan_items" DROP CONSTRAINT IF EXISTS "loan_items_loanId_fkey";
ALTER TABLE "loan_items" DROP CONSTRAINT IF EXISTS "loan_items_copyId_fkey";
ALTER TABLE "fines" DROP CONSTRAINT IF EXISTS "fines_loanItemId_fkey";
ALTER TABLE "fine_payments" DROP CONSTRAINT IF EXISTS "fine_payments_fineId_fkey";
ALTER TABLE "fine_payments" DROP CONSTRAINT IF EXISTS "fine_payments_receivedById_fkey";

-- Step 4: Add composite FKs enforcing same-school.

ALTER TABLE "books" ADD CONSTRAINT "books_categoryId_schoolId_fkey"
  FOREIGN KEY ("categoryId", "schoolId") REFERENCES "categories"("id", "schoolId")
  ON UPDATE CASCADE;

ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_bookId_schoolId_fkey"
  FOREIGN KEY ("bookId", "schoolId") REFERENCES "books"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ebook_accesses" ADD CONSTRAINT "ebook_accesses_ebookId_schoolId_fkey"
  FOREIGN KEY ("ebookId", "schoolId") REFERENCES "ebooks"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ebook_accesses" ADD CONSTRAINT "ebook_accesses_studentId_schoolId_fkey"
  FOREIGN KEY ("studentId", "schoolId") REFERENCES "students"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_bookId_schoolId_fkey"
  FOREIGN KEY ("bookId", "schoolId") REFERENCES "books"("id", "schoolId")
  ON UPDATE CASCADE;

ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_shelfId_schoolId_fkey"
  FOREIGN KEY ("shelfId", "schoolId") REFERENCES "shelves"("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loans" ADD CONSTRAINT "loans_studentId_schoolId_fkey"
  FOREIGN KEY ("studentId", "schoolId") REFERENCES "students"("id", "schoolId")
  ON UPDATE CASCADE;

ALTER TABLE "loans" ADD CONSTRAINT "loans_processedById_schoolId_fkey"
  FOREIGN KEY ("processedById", "schoolId") REFERENCES "users"("id", "schoolId")
  ON UPDATE CASCADE;

ALTER TABLE "loan_items" ADD CONSTRAINT "loan_items_loanId_schoolId_fkey"
  FOREIGN KEY ("loanId", "schoolId") REFERENCES "loans"("id", "schoolId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loan_items" ADD CONSTRAINT "loan_items_copyId_schoolId_fkey"
  FOREIGN KEY ("copyId", "schoolId") REFERENCES "book_copies"("id", "schoolId")
  ON UPDATE CASCADE;

ALTER TABLE "fines" ADD CONSTRAINT "fines_loanItemId_schoolId_fkey"
  FOREIGN KEY ("loanItemId", "schoolId") REFERENCES "loan_items"("id", "schoolId")
  ON UPDATE CASCADE;

ALTER TABLE "fine_payments" ADD CONSTRAINT "fine_payments_fineId_schoolId_fkey"
  FOREIGN KEY ("fineId", "schoolId") REFERENCES "fines"("id", "schoolId")
  ON UPDATE CASCADE;

ALTER TABLE "fine_payments" ADD CONSTRAINT "fine_payments_receivedById_schoolId_fkey"
  FOREIGN KEY ("receivedById", "schoolId") REFERENCES "users"("id", "schoolId")
  ON UPDATE CASCADE;

