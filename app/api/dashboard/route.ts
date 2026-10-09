import { NextResponse } from "next/server";
import { BookStatus, FineStatus, LoanStatus, Prisma } from "@/app/generated/prisma/client";
import { noStoreHeaders, requireAuthenticatedUser } from "@/lib/auth";
import { calculateDaysLate } from "@/lib/fine";
import { getBookCoverUrl } from "@/lib/book-cover-url";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const activeLoanStatuses = [LoanStatus.AKTIF, LoanStatus.SEBAGIAN_DIKEMBALIKAN];

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders });
}

function money(value: Prisma.Decimal | null | undefined) {
  return value?.toFixed(2) ?? "0.00";
}

function serializeFine<T extends { ratePerDay: Prisma.Decimal; amount: Prisma.Decimal; payment?: { amount: Prisma.Decimal } | null }>(fine: T) {
  return {
    ...fine,
    ratePerDay: money(fine.ratePerDay),
    amount: money(fine.amount),
    payment: fine.payment ? { ...fine.payment, amount: money(fine.payment.amount) } : null,
  };
}

async function serializeBookCover<T extends { coverUrl: string | null }>(book: T) {
  return { ...book, coverUrl: await getBookCoverUrl(book.coverUrl) };
}

async function serializeActiveLoanCovers<T extends { items: Array<{ copy: { book: { coverUrl: string | null } } }> }>(loans: T[]) {
  return Promise.all(loans.map(async (loan) => ({
    ...loan,
    items: await Promise.all(loan.items.map(async (item) => ({
      ...item,
      copy: { ...item.copy, book: await serializeBookCover(item.copy.book) },
    }))),
  })));
}

async function getLibrarianDashboard(schoolId: string) {
  const now = new Date();
  const activeBookCopy = { schoolId, isActive: true, book: { isActive: true, category: { is: { isActive: true } } } };

  const [activeBooks, totalBooks, availableCopies, borrowedCopies, damagedCopies, lostCopies, activeMembers, inactiveMembers, activeLoans, overdueLoans, unpaidFineSummary, paidFineSummary, unpaidFineCount, paidFineCount, recentLoans, recentPayments] = await prisma.$transaction([
    prisma.book.count({ where: { schoolId, isActive: true } }),
    prisma.book.count({ where: { schoolId } }),
    prisma.bookCopy.count({ where: { ...activeBookCopy, status: BookStatus.TERSEDIA } }),
    prisma.bookCopy.count({ where: { ...activeBookCopy, status: BookStatus.DIPINJAM } }),
    prisma.bookCopy.count({ where: { ...activeBookCopy, status: BookStatus.RUSAK } }),
    prisma.bookCopy.count({ where: { ...activeBookCopy, status: BookStatus.HILANG } }),
    prisma.student.count({ where: { schoolId, isActive: true, user: { status: "AKTIF" } } }),
    prisma.student.count({ where: { schoolId, OR: [{ isActive: false }, { user: { status: "NONAKTIF" } }] } }),
    prisma.loan.count({ where: { schoolId, status: { in: activeLoanStatuses } } }),
    prisma.loan.count({ where: { schoolId, status: { in: activeLoanStatuses }, dueDate: { lt: now } } }),
    prisma.fine.aggregate({ where: { schoolId, status: FineStatus.BELUM_DIBAYAR }, _sum: { amount: true } }),
    prisma.fine.aggregate({ where: { schoolId, status: FineStatus.LUNAS }, _sum: { amount: true } }),
    prisma.fine.count({ where: { schoolId, status: FineStatus.BELUM_DIBAYAR } }),
    prisma.fine.count({ where: { schoolId, status: FineStatus.LUNAS } }),
    prisma.loan.findMany({ where: { schoolId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10, select: { id: true, loanDate: true, dueDate: true, returnedAt: true, status: true, student: { select: { id: true, nis: true, name: true, className: true } }, items: { select: { id: true, returnedAt: true, copy: { select: { barcode: true, book: { select: { id: true, title: true } } } } } } } }),
    prisma.finePayment.findMany({ where: { schoolId }, orderBy: [{ paidAt: "desc" }, { id: "desc" }], take: 10, select: { id: true, amount: true, paymentMethod: true, receiptNumber: true, paidAt: true, note: true, receivedBy: { select: { id: true, name: true, username: true } }, fine: { select: { id: true, loanItem: { select: { loan: { select: { student: { select: { id: true, nis: true, name: true, className: true } } } } } } } } } }),
  ]);

  return {
    role: "PUSTAKAWAN" as const,
    data: {
      books: { active: activeBooks, total: totalBooks },
      copies: { available: availableCopies, borrowed: borrowedCopies, damaged: damagedCopies, lost: lostCopies },
      members: { active: activeMembers, inactive: inactiveMembers },
      loans: { active: activeLoans, overdue: overdueLoans },
      fines: { unpaidCount: unpaidFineCount, unpaidAmount: money(unpaidFineSummary._sum.amount), paidCount: paidFineCount, paidAmount: money(paidFineSummary._sum.amount) },
      recentLoans,
      recentPayments: recentPayments.map((payment) => ({ ...payment, amount: money(payment.amount) })),
    },
  };
}

async function getStudentDashboard(userId: string, schoolId: string) {
  const student = await prisma.student.findFirst({ where: { userId, schoolId, isActive: true, user: { status: "AKTIF" } }, select: { id: true, nis: true, name: true, className: true, libraryCardNumber: true, phone: true } });
  if (!student) throw new Error("STUDENT_NOT_FOUND");

  const now = new Date();
  const [activeLoanCount, overdueLoanCount, unpaidFineCount, unpaidFineSummary, activeLoans, recentLoans, unpaidFines] = await prisma.$transaction([
    prisma.loan.count({ where: { schoolId, studentId: student.id, status: { in: activeLoanStatuses } } }),
    prisma.loan.count({ where: { schoolId, studentId: student.id, status: { in: activeLoanStatuses }, dueDate: { lt: now } } }),
    prisma.fine.count({ where: { schoolId, status: FineStatus.BELUM_DIBAYAR, loanItem: { loan: { studentId: student.id } } } }),
    prisma.fine.aggregate({ where: { schoolId, status: FineStatus.BELUM_DIBAYAR, loanItem: { loan: { studentId: student.id } } }, _sum: { amount: true } }),
    prisma.loan.findMany({ where: { schoolId, studentId: student.id, status: { in: activeLoanStatuses } }, orderBy: [{ dueDate: "asc" }, { id: "asc" }], select: { id: true, loanDate: true, dueDate: true, returnedAt: true, status: true, notes: true, items: { where: { returnedAt: null }, select: { id: true, copyId: true, returnedAt: true, copy: { select: { id: true, barcode: true, book: { select: { id: true, title: true, publisher: true, coverUrl: true } } } } } } } }),
    prisma.loan.findMany({ where: { schoolId, studentId: student.id }, orderBy: [{ loanDate: "desc" }, { id: "desc" }], take: 10, select: { id: true, loanDate: true, dueDate: true, returnedAt: true, status: true, notes: true, items: { select: { id: true, returnedAt: true, copy: { select: { barcode: true, book: { select: { id: true, title: true } } } } } } } }),
    prisma.fine.findMany({
      where: { schoolId, status: FineStatus.BELUM_DIBAYAR, loanItem: { loan: { studentId: student.id } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
      select: {
        id: true,
        type: true,
        daysLate: true,
        ratePerDay: true,
        amount: true,
        status: true,
        note: true,
        createdAt: true,
        loanItem: {
          select: {
            id: true,
            returnedAt: true,
            copy: { select: { barcode: true, book: { select: { id: true, title: true } } } },
            loan: { select: { id: true, loanDate: true, dueDate: true, returnedAt: true } },
          },
        },
        payment: { select: { id: true, amount: true } },
      },
    }),
  ]);

  return {
    role: "SISWA" as const,
    data: {
      student,
      loans: { active: activeLoanCount, overdue: overdueLoanCount },
      fines: { unpaidCount: unpaidFineCount, unpaidAmount: money(unpaidFineSummary._sum.amount) },
      activeLoans: await serializeActiveLoanCovers(activeLoans.map((loan) => ({ ...loan, daysLate: calculateDaysLate(loan.dueDate, now) }))),
      recentLoans,
      unpaidFines: unpaidFines.map(serializeFine),
    },
  };
}

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  try {
    const dashboard = auth.user.role === "PUSTAKAWAN" ? await getLibrarianDashboard(auth.schoolId) : await getStudentDashboard(auth.user.id, auth.schoolId);
    return NextResponse.json({ ...dashboard, generatedAt: new Date() }, { headers: noStoreHeaders });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "STUDENT_NOT_FOUND") return errorResponse("Data siswa tidak ditemukan.", 404);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
