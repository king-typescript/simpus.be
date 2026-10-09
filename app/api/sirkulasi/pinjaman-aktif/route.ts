import { NextResponse } from "next/server";
import { LoanStatus, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireLibrarian } from "@/lib/auth";
import { calculateDaysLate, calculateFine } from "@/lib/fine";
import {
  isUuid,
  parsePagination,
} from "@/lib/validation";

export const runtime = "nodejs";


function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function serializeFine(fine: {
  id: string;
  type: string;
  daysLate: number;
  ratePerDay: { toFixed: (digits: number) => string };
  amount: { toFixed: (digits: number) => string };
  status: string;
  note: string | null;
}) {
  return {
    id: fine.id,
    type: fine.type,
    daysLate: fine.daysLate,
    ratePerDay: fine.ratePerDay.toFixed(2),
    amount: fine.amount.toFixed(2),
    status: fine.status,
    note: fine.note,
  };
}

export async function GET(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  const url = new URL(request.url);
  const pagination = parsePagination(url.searchParams);
  if (!pagination.ok) return errorResponse(pagination.error, 422);
  const { page, limit } = pagination.value;
  const studentId = url.searchParams.get("studentId")?.trim() ?? "";
  const overdue = url.searchParams.get("overdue")?.trim() ?? "";

  if (studentId && !isUuid(studentId)) return errorResponse("Student ID tidak valid.", 422);
  if (overdue && overdue !== "true" && overdue !== "false") return errorResponse("Filter overdue tidak valid.", 422);

  const now = new Date();
  const today = startOfUtcDay(now);
  const where = {
    schoolId: auth.schoolId,
    status: { in: [LoanStatus.AKTIF, LoanStatus.SEBAGIAN_DIKEMBALIKAN] },
    ...(studentId ? { studentId } : {}),
    ...(overdue === "true" ? { dueDate: { lt: today } } : {}),
    ...(overdue === "false" ? { dueDate: { gte: today } } : {}),
  };

  try {
    const [settings, loans, total] = await prisma.$transaction([
      prisma.librarySetting.findUnique({
        where: { schoolId: auth.schoolId },
        select: { fineRatePerDay: true },
      }),
      prisma.loan.findMany({
        where,
        select: {
          id: true,
          studentId: true,
          loanDate: true,
          dueDate: true,
          status: true,
          notes: true,
          student: {
            select: { id: true, nis: true, name: true, className: true },
          },
          items: {
            where: { returnedAt: null },
            select: {
              id: true,
              copyId: true,
              returnedAt: true,
              fine: {
                select: {
                  id: true,
                  type: true,
                  daysLate: true,
                  ratePerDay: true,
                  amount: true,
                  status: true,
                  note: true,
                },
              },
              copy: {
                select: {
                  id: true,
                  barcode: true,
                  status: true,
                  book: { select: { id: true, title: true } },
                },
              },
            },
          },
        },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.loan.count({ where }),
    ]);

    if (!settings) return errorResponse("Pengaturan perpustakaan belum tersedia.", 500);

    const data = loans.map((loan) => {
      const daysLate = calculateDaysLate(loan.dueDate, now);
      let recordedAmount = new Prisma.Decimal(0);
      let projectedAmount = new Prisma.Decimal(0);
      let recordedCount = 0;
      let projectedCount = 0;

      const items = loan.items.map((item) => {
        if (item.fine) {
          const fine = serializeFine(item.fine);
          recordedAmount = recordedAmount.add(new Prisma.Decimal(fine.amount));
          recordedCount += 1;
          return { ...item, fineSource: "RECORDED" as const, fine, projectedFine: null };
        }

        if (daysLate > 0) {
          const projectedFine = {
            daysLate,
            ratePerDay: settings.fineRatePerDay.toFixed(2),
            amount: calculateFine(daysLate, settings.fineRatePerDay).toFixed(2),
          };
          projectedAmount = projectedAmount.add(new Prisma.Decimal(projectedFine.amount));
          projectedCount += 1;
          return { ...item, fineSource: "PROJECTED" as const, fine: null, projectedFine };
        }

        return { ...item, fineSource: null, fine: null, projectedFine: null };
      });

      return {
        loanId: loan.id,
        student: loan.student,
        loanDate: loan.loanDate,
        dueDate: loan.dueDate,
        status: loan.status,
        notes: loan.notes,
        daysLate,
        items,
        fineSummary: {
          recordedCount,
          recordedAmount: recordedAmount.toFixed(2),
          projectedCount,
          projectedAmount: projectedAmount.toFixed(2),
        },
      };
    });

    return NextResponse.json(
      {
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
      { headers: noStoreHeaders },
    );
  } catch {
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
