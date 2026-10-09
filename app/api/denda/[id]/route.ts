import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireLibrarian } from "@/lib/auth";
import { getClientIp, hasOnlyFields, isRecord, isUuid } from "@/lib/validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

function validMoney(value: string) {
  return /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value);
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function isTransactionConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

function isOriginAllowed(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
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

const fineSelect = {
  id: true,
  loanItemId: true,
  type: true,
  daysLate: true,
  ratePerDay: true,
  amount: true,
  status: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  loanItem: {
    select: {
      id: true,
      returnedAt: true,
      returnCondition: true,
      returnNote: true,
      loan: {
        select: {
          id: true,
          loanDate: true,
          dueDate: true,
          returnedAt: true,
          status: true,
          student: { select: { id: true, nis: true, name: true, className: true, libraryCardNumber: true } },
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
  payment: {
    select: {
      id: true,
      fineId: true,
      amount: true,
      paymentMethod: true,
      receiptNumber: true,
      paidAt: true,
      note: true,
      receivedBy: { select: { id: true, name: true, username: true } },
    },
  },
} as const;

function serializeFine(fine: Prisma.FineGetPayload<{ select: typeof fineSelect }>) {
  return {
    ...fine,
    ratePerDay: fine.ratePerDay.toFixed(2),
    amount: fine.amount.toFixed(2),
    payment: fine.payment ? { ...fine.payment, amount: fine.payment.amount.toFixed(2) } : null,
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID denda tidak valid.", 422);

  try {
    const fine = await prisma.fine.findUnique({ where: { id, schoolId: auth.schoolId }, select: fineSelect });
    return fine ? NextResponse.json({ data: serializeFine(fine) }, { headers: noStoreHeaders }) : errorResponse("Denda tidak ditemukan.", 404);
  } catch {
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  if (!isOriginAllowed(request)) return errorResponse("Origin tidak diizinkan.", 403);

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID denda tidak valid.", 422);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Body JSON tidak valid.", 400);
  }

  if (!isRecord(body) || !hasOnlyFields(body, ["receiptNumber", "amount", "note"])) {
    return errorResponse("Body request tidak valid.", 422);
  }

  const receiptNumber = typeof body.receiptNumber === "string" ? body.receiptNumber.trim() : "";
  const amount = typeof body.amount === "string" ? body.amount.trim() : "";
  const note = body.note === undefined || body.note === null ? null : typeof body.note === "string" ? body.note.trim() || null : undefined;

  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(receiptNumber) || !validMoney(amount) || note === undefined || (note !== null && note.length > 1000)) {
    return errorResponse("Data pembayaran tidak valid.", 422);
  }

  const ipAddress = getClientIp(request);

  try {
    const result = await serializable(() => prisma.$transaction(async (tx) => {
      const fine = await tx.fine.findUnique({ where: { id, schoolId: auth.schoolId }, select: fineSelect });
      if (!fine) throw new Error("FINE_NOT_FOUND");
      if (fine.status !== "BELUM_DIBAYAR") throw new Error("FINE_ALREADY_SETTLED");
      if (fine.payment) throw new Error("PAYMENT_EXISTS");
      if (!fine.loanItem.returnedAt) throw new Error("BOOK_NOT_RETURNED");

      const paymentAmount = new Prisma.Decimal(amount);
      if (!paymentAmount.equals(fine.amount)) throw new Error("AMOUNT_MISMATCH");

      const payment = await tx.finePayment.create({
        data: { schoolId: auth.schoolId, fineId: id, receivedById: auth.user.id, amount: paymentAmount, paymentMethod: "CASH", receiptNumber, note },
        select: { id: true, fineId: true, amount: true, paymentMethod: true, receiptNumber: true, paidAt: true, note: true, receivedBy: { select: { id: true, name: true, username: true } } },
      });
      await tx.fine.update({ where: { id, schoolId: auth.schoolId }, data: { status: "LUNAS" } });
      const updatedFine = await tx.fine.findUniqueOrThrow({ where: { id, schoolId: auth.schoolId }, select: fineSelect });

      await tx.auditLog.create({
        data: { schoolId: auth.schoolId, userId: auth.user.id, action: "PAYMENT", entityType: "Fine", entityId: id, oldData: jsonValue(fine), newData: jsonValue(updatedFine), ipAddress },
      });

      return { fine: updatedFine, payment };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    return NextResponse.json({ data: { fine: serializeFine(result.fine), payment: { ...result.payment, amount: result.payment.amount.toFixed(2) } } }, { status: 201, headers: noStoreHeaders });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "FINE_NOT_FOUND") return errorResponse("Denda tidak ditemukan.", 404);
    if (error instanceof Error && error.message === "FINE_ALREADY_SETTLED") return errorResponse("Denda sudah diselesaikan.", 409);
    if (error instanceof Error && error.message === "PAYMENT_EXISTS") return errorResponse("Pembayaran denda sudah tercatat.", 409);
    if (error instanceof Error && error.message === "AMOUNT_MISMATCH") return errorResponse("Nominal pembayaran harus sama dengan nominal denda.", 422);
    if (error instanceof Error && error.message === "BOOK_NOT_RETURNED") return errorResponse("Denda belum dapat dibayar sebelum buku dikembalikan.", 422);
    if (isTransactionConflict(error)) return errorResponse("Permintaan konflik, coba lagi.", 409);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return errorResponse("Nomor kuitansi sudah digunakan.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
