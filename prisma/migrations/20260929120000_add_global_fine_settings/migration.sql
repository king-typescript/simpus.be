-- CreateTable
CREATE TABLE "library_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'DEFAULT',
    "maxLoanDays" INTEGER NOT NULL DEFAULT 7,
    "maxActiveCopies" INTEGER NOT NULL DEFAULT 3,
    "fineRatePerDay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "library_settings_key_key" ON "library_settings"("key");