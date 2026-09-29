import { Prisma } from "@/app/generated/prisma/client";

const MILLISECONDS_PER_DAY = 86_400_000;

export function calculateDaysLate(dueDate: Date, referenceDate = new Date()) {
  const dueDay = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const referenceDay = Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate());
  return Math.max(0, Math.ceil((referenceDay - dueDay) / MILLISECONDS_PER_DAY));
}

export function calculateFine(daysLate: number, ratePerDay: Prisma.Decimal) {
  if (!Number.isInteger(daysLate) || daysLate < 0) {
    throw new Error("daysLate must be a non-negative integer.");
  }

  return ratePerDay.mul(daysLate);
}
