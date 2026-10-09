import { NextResponse } from "next/server";
import { LoanStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireLibrarian } from "@/lib/auth";
import {
  getClientIp,
  hasOnlyFields,
  isJsonContentType,
  isRecord,
  isUuid,
  parseInteger,
  parseOptionalString,
} from "@/lib/validation";

export const runtime = "nodejs";

const MAX_RENEWAL_COUNT = 1;
const MAX_ADDITIONAL_DAYS = 7;
const RENEWAL_ACTION = "RENEW";
const ENTITY_TYPE = "Loan";

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

async function serializable<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      const conflict = typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
      if (!conflict || attempt === 2) throw error;
    }
  }
  throw new Error("TRANSACTION_CONFLICT");
}

export async function POST(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  if (!isJsonContentType(request)) return errorResponse("Content-Type harus application/json.", 415);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("Body JSON tidak valid.", 400); }

  if (!isRecord(body) || !hasOnlyFields(body, ["loanId", "additionalDays", "notes"])) {
    return errorResponse("Body request tidak valid.", 422);
  }

  const loanId = body.loanId;
  const daysResult = parseInteger(body.additionalDays, { field: "Jumlah hari perpanjangan", min: 1, max: MAX_ADDITIONAL_DAYS });
  const notesResult = parseOptionalString(body.notes, { field: "Catatan", maxLength: 1000 });

  if (!isUuid(loanId)) return errorResponse("Loan ID tidak valid.", 422);
  if (!daysResult.ok) return errorResponse(daysResult.error, 422);
  if (!notesResult.ok) return errorResponse(notesResult.error, 422);

  const additionalDays = daysResult.value;
  const notes = notesResult.value ?? null;

  try {
    const result = await serializable(() =>
      prisma.$transaction(async (tx) => {
        const loan = await tx.loan.findUnique({
          where: { id: loanId, schoolId: auth.schoolId },
          select: {
            id: true,
            dueDate: true,
            status: true,
            notes: true,
            items: { select: { id: true, returnedAt: true } },
          },
        });

        if (!loan) throw new Error("LOAN_NOT_FOUND");
        if (loan.status !== LoanStatus.AKTIF && loan.status !== LoanStatus.SEBAGIAN_DIKEMBALIKAN) throw new Error("LOAN_NOT_RENEWABLE");
        if (!loan.items.some((item) => item.returnedAt === null)) throw new Error("LOAN_ALREADY_RETURNED");

        const renewalCount = await tx.auditLog.count({
          where: { schoolId: auth.schoolId, action: RENEWAL_ACTION, entityType: ENTITY_TYPE, entityId: loan.id },
        });
        if (renewalCount >= MAX_RENEWAL_COUNT) throw new Error("RENEWAL_LIMIT_REACHED");

        const oldDueDate = loan.dueDate;
        const newDueDate = new Date(oldDueDate);
        newDueDate.setUTCDate(newDueDate.getUTCDate() + additionalDays);

        const updatedLoan = await tx.loan.update({
          where: { id: loan.id, schoolId: auth.schoolId },
          data: { dueDate: newDueDate, ...(notes !== null ? { notes } : {}) },
          select: { id: true, dueDate: true, status: true, notes: true },
        });

        await tx.auditLog.create({
          data: {
            schoolId: auth.schoolId,
            userId: auth.user.id,
            action: RENEWAL_ACTION,
            entityType: ENTITY_TYPE,
            entityId: loan.id,
            oldData: jsonValue({ dueDate: oldDueDate, renewalCount, notes: loan.notes }),
            newData: jsonValue({ dueDate: newDueDate, renewalCount: renewalCount + 1, additionalDays, notes: updatedLoan.notes }),
            ipAddress: getClientIp(request),
          },
        });

        return {
          loanId: updatedLoan.id,
          oldDueDate,
          dueDate: updatedLoan.dueDate,
          renewalCount: renewalCount + 1,
          maxRenewalCount: MAX_RENEWAL_COUNT,
          status: updatedLoan.status,
          notes: updatedLoan.notes,
        };
      }, { isolationLevel: "Serializable" }),
    );

    return NextResponse.json({ data: result }, { status: 200, headers: noStoreHeaders });
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message === "LOAN_NOT_FOUND") return errorResponse("Pinjaman tidak ditemukan.", 404);
      if (error.message === "LOAN_NOT_RENEWABLE") return errorResponse("Pinjaman sudah selesai atau dibatalkan.", 422);
      if (error.message === "LOAN_ALREADY_RETURNED") return errorResponse("Semua buku dalam pinjaman sudah dikembalikan.", 422);
      if (error.message === "RENEWAL_LIMIT_REACHED") return errorResponse("Batas perpanjangan pinjaman sudah tercapai.", 409);
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") {
      return errorResponse("Data berubah bersamaan. Silakan coba lagi.", 409);
    }
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
