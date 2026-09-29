import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { noStoreHeaders } from "@/lib/auth";
import { calculateDaysLate } from "@/lib/fine";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_BATCH_SIZE = 500;
const SETTING_KEY = "DEFAULT";

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function isTransactionConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

async function serializable<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (!isTransactionConflict(error) || attempt === 2) throw error;
    }
  }
  throw new Error("TRANSACTION_CONFLICT");
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return errorResponse("Tidak memiliki akses.", 401);

  const now = new Date();

  try {
    const settings = await prisma.librarySetting.findUnique({ where: { key: SETTING_KEY }, select: { fineRatePerDay: true } });
    if (!settings) return errorResponse("Pengaturan perpustakaan belum tersedia.", 500);

    const candidates = await prisma.loanItem.findMany({
      where: { returnedAt: null, loan: { status: { in: ["AKTIF", "SEBAGIAN_DIKEMBALIKAN"] }, dueDate: { lt: now } } },
      orderBy: [{ loan: { dueDate: "asc" } }, { id: "asc" }],
      take: MAX_BATCH_SIZE,
      select: { id: true },
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const result = await serializable(() => prisma.$transaction(async (tx) => {
        const item = await tx.loanItem.findUnique({
          where: { id: candidate.id },
          select: {
            id: true,
            returnedAt: true,
            loan: { select: { dueDate: true, status: true } },
            fine: { select: { id: true, status: true, daysLate: true, ratePerDay: true, amount: true } },
          },
        });

        if (!item || item.returnedAt || !["AKTIF", "SEBAGIAN_DIKEMBALIKAN"].includes(item.loan.status)) return "SKIPPED" as const;

        const daysLate = calculateDaysLate(item.loan.dueDate, now);
        if (daysLate <= 0 || (item.fine && item.fine.status !== "BELUM_DIBAYAR")) return "SKIPPED" as const;

        if (!item.fine) {
          const fine = await tx.fine.create({
            data: { loanItemId: item.id, type: "TERLAMBAT", daysLate, ratePerDay: settings.fineRatePerDay, amount: settings.fineRatePerDay.mul(daysLate), status: "BELUM_DIBAYAR", note: `Denda otomatis keterlambatan ${daysLate} hari.` },
            select: { id: true, daysLate: true, ratePerDay: true, amount: true, status: true },
          });
          await tx.auditLog.create({ data: { action: "CREATE", entityType: "Fine", entityId: fine.id, newData: jsonValue(fine) } });
          return "CREATED" as const;
        }

        const amount = item.fine.ratePerDay.mul(daysLate);
        if (item.fine.daysLate === daysLate && item.fine.amount.equals(amount)) return "SKIPPED" as const;

        const fine = await tx.fine.update({
          where: { id: item.fine.id },
          data: { daysLate, amount, note: `Denda otomatis keterlambatan ${daysLate} hari.` },
          select: { id: true, daysLate: true, ratePerDay: true, amount: true, status: true },
        });
        await tx.auditLog.create({ data: { action: "UPDATE", entityType: "Fine", entityId: fine.id, oldData: jsonValue(item.fine), newData: jsonValue(fine) } });
        return "UPDATED" as const;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

      if (result === "CREATED") created += 1;
      else if (result === "UPDATED") updated += 1;
      else skipped += 1;
    }

    return NextResponse.json({ data: { processed: candidates.length, created, updated, skipped, hasMore: candidates.length === MAX_BATCH_SIZE } }, { headers: noStoreHeaders });
  } catch (error: unknown) {
    if (isTransactionConflict(error)) return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
