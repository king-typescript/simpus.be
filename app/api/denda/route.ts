import { NextResponse } from "next/server";
import { FineStatus, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireLibrarian } from "@/lib/auth";
import { parsePagination, parseSearch } from "@/lib/validation";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_PAGE = 10_000;
function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

const fineSelect = {
  id: true,
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
      loan: {
        select: {
          id: true,
          loanDate: true,
          dueDate: true,
          returnedAt: true,
          student: { select: { id: true, nis: true, name: true, className: true, libraryCardNumber: true } },
        },
      },
      copy: {
        select: {
          id: true,
          barcode: true,
          book: { select: { id: true, title: true } },
        },
      },
    },
  },
  payment: {
    select: {
      id: true,
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
    payment: fine.payment
      ? { ...fine.payment, amount: fine.payment.amount.toFixed(2) }
      : null,
  };
}

export async function GET(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  const url = new URL(request.url);
  const pagination = parsePagination(url.searchParams, {
    defaultLimit: DEFAULT_LIMIT,
    maxLimit: MAX_LIMIT,
    maxPage: MAX_PAGE,
  });
  if (!pagination.ok) return errorResponse(pagination.error, 422);
  const { page, limit } = pagination.value;
  const status = url.searchParams.get("status");
  const searchResult = parseSearch(url.searchParams, 100);
  if (!searchResult.ok) return errorResponse("Pencarian terlalu panjang.", 422);
  const search = searchResult.value;

  if (status && !Object.values(FineStatus).includes(status as FineStatus)) {
    return errorResponse("Status denda tidak valid.", 422);
  }
  const where = {
    schoolId: auth.schoolId,
    ...(status ? { status: status as FineStatus } : {}),
    ...(search
      ? {
          OR: [
            { loanItem: { loan: { student: { name: { contains: search, mode: "insensitive" as const } } } } },
            { loanItem: { loan: { student: { nis: { contains: search, mode: "insensitive" as const } } } } },
            { loanItem: { loan: { student: { libraryCardNumber: { contains: search, mode: "insensitive" as const } } } } },
            { loanItem: { copy: { barcode: { contains: search, mode: "insensitive" as const } } } },
            { loanItem: { copy: { book: { title: { contains: search, mode: "insensitive" as const } } } } },
            { payment: { receiptNumber: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  try {
    const [fines, total] = await prisma.$transaction([
      prisma.fine.findMany({
        where: { ...where, schoolId: auth.schoolId },
        select: fineSelect,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.fine.count({ where }),
    ]);

    return NextResponse.json(
      { data: fines.map(serializeFine), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } },
      { headers: noStoreHeaders },
    );
  } catch {
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
