/*
  Warnings:

  - You are about to drop the column `fineId` on the `loan_items` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "fines" DROP CONSTRAINT "fines_loanItemId_fkey";

-- DropForeignKey
ALTER TABLE "loan_items" DROP CONSTRAINT "loan_items_fineId_fkey";

-- AlterTable
ALTER TABLE "loan_items" DROP COLUMN "fineId";

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_loanItemId_fkey" FOREIGN KEY ("loanItemId") REFERENCES "loan_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
