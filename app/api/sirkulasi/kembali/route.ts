import { NextResponse } from "next/server";
import { BookStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireLibrarian } from "@/lib/auth";
import { calculateDaysLate, calculateFine } from "@/lib/fine";
import {
  getClientIp,
  hasOnlyFields,
  isJsonContentType,
  isRecord,
  isUuid,
  parseEnum,
  parseOptionalString,
} from "@/lib/validation";

export const runtime = "nodejs";
const returnStatuses = ["TERSEDIA", "RUSAK", "HILANG"] as const;
function errorResponse(error: string, status: number) { return NextResponse.json({ error }, { status, headers: noStoreHeaders }); }
function jsonValue(value: unknown) { return JSON.parse(JSON.stringify(value)); }
async function serializable<T>(operation: () => Promise<T>) { for (let attempt = 0; attempt < 3; attempt += 1) { try { return await operation(); } catch (error: unknown) { const conflict = typeof error === "object" && error !== null && "code" in error && error.code === "P2034"; if (!conflict || attempt === 2) throw error; } } throw new Error("TRANSACTION_CONFLICT"); }

export async function POST(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  if (!isJsonContentType(request)) return errorResponse("Content-Type harus application/json.", 415);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("Body JSON tidak valid.", 400); }
  if (!isRecord(body) || !hasOnlyFields(body, ["loanItemId", "status", "returnCondition", "returnNote"])) return errorResponse("Body request tidak valid.", 422);
  const loanItemId = body.loanItemId;
  const statusResult = parseEnum(body.status, returnStatuses, "Status pengembalian");
  const conditionResult = parseOptionalString(body.returnCondition, { field: "Kondisi pengembalian", maxLength: 1000 });
  const noteResult = parseOptionalString(body.returnNote, { field: "Catatan pengembalian", maxLength: 1000 });
  if (!isUuid(loanItemId) || !statusResult.ok || !conditionResult.ok || !noteResult.ok) return errorResponse("Data pengembalian tidak valid.", 422);
  const status = statusResult.value;
  const returnCondition = conditionResult.value ?? null;
  const returnNote = noteResult.value ?? null;
  if ((status === "RUSAK" || status === "HILANG") && !returnCondition) return errorResponse("Kondisi pengembalian wajib diisi.", 422);

  try {
    const result = await serializable(() => prisma.$transaction(async (tx) => {
      const item = await tx.loanItem.findUnique({ where: { id: loanItemId, schoolId: auth.schoolId }, select: { id: true, loanId: true, copyId: true, returnedAt: true, returnCondition: true, returnNote: true, loan: { select: { id: true, schoolId: true, dueDate: true, status: true } }, copy: { select: { id: true, schoolId: true, status: true, isActive: true } } } });
      if (!item || item.loan.schoolId !== auth.schoolId || item.copy.schoolId !== auth.schoolId) throw new Error("ITEM_NOT_FOUND");
      if (item.returnedAt || item.loan.status === "SELESAI" || item.loan.status === "DIBATALKAN") throw new Error("ALREADY_RETURNED");
      if (!item.copy.isActive || item.copy.status !== "DIPINJAM") throw new Error("COPY_INVALID");
      const settings = await tx.librarySetting.findUnique({ where: { schoolId: auth.schoolId }, select: { fineRatePerDay: true } });
      if (!settings) throw new Error("SETTINGS_NOT_FOUND");
      const returnedAt = new Date();
      const lateDays = calculateDaysLate(item.loan.dueDate, returnedAt);
      const amount = calculateFine(lateDays, settings.fineRatePerDay);
      const existingFine = await tx.fine.findUnique({ where: { loanItemId, schoolId: auth.schoolId }, select: { id: true, type: true, daysLate: true, ratePerDay: true, amount: true, status: true, note: true } });
      const updatedItem = await tx.loanItem.update({ where: { id: loanItemId, schoolId: auth.schoolId }, data: { returnedAt, returnCondition, returnNote, copy: { update: { status: status as BookStatus, conditionNote: returnCondition } } }, select: { id: true, loanId: true, copyId: true, returnedAt: true, returnCondition: true, returnNote: true, copy: { select: { id: true, barcode: true, status: true } } } });
      let fineResult: { daysLate: number; ratePerDay: string; amount: string } | null = null;
      if (lateDays > 0) {
        if (!existingFine) {
          const fine = await tx.fine.create({ data: { schoolId: auth.schoolId, loanItemId, daysLate: lateDays, ratePerDay: settings.fineRatePerDay, amount, status: "BELUM_DIBAYAR", note: `Denda keterlambatan ${lateDays} hari.` }, select: { id: true, daysLate: true, ratePerDay: true, amount: true, status: true } });
          await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "CREATE", entityType: "Fine", entityId: fine.id, newData: jsonValue(fine), ipAddress: getClientIp(request) } });
          fineResult = { daysLate: fine.daysLate, ratePerDay: fine.ratePerDay.toFixed(2), amount: fine.amount.toFixed(2) };
        } else if (existingFine.status === "BELUM_DIBAYAR") {
          const updatedAmount = existingFine.ratePerDay.mul(lateDays);
          const fine = await tx.fine.update({ where: { id: existingFine.id, schoolId: auth.schoolId }, data: { daysLate: lateDays, amount: updatedAmount, note: `Denda keterlambatan ${lateDays} hari.` }, select: { id: true, daysLate: true, ratePerDay: true, amount: true, status: true } });
          await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "UPDATE", entityType: "Fine", entityId: fine.id, oldData: jsonValue(existingFine), newData: jsonValue(fine), ipAddress: getClientIp(request) } });
          fineResult = { daysLate: fine.daysLate, ratePerDay: fine.ratePerDay.toFixed(2), amount: fine.amount.toFixed(2) };
        } else {
          fineResult = { daysLate: existingFine.daysLate, ratePerDay: existingFine.ratePerDay.toFixed(2), amount: existingFine.amount.toFixed(2) };
        }
      }
      const openItems = await tx.loanItem.count({ where: { schoolId: auth.schoolId, loanId: item.loanId, returnedAt: null } });
      const returnedItems = await tx.loanItem.count({ where: { schoolId: auth.schoolId, loanId: item.loanId, returnedAt: { not: null } } });
      await tx.loan.update({ where: { id: item.loanId, schoolId: auth.schoolId }, data: { status: openItems === 0 ? "SELESAI" : returnedItems > 0 ? "SEBAGIAN_DIKEMBALIKAN" : "AKTIF", returnedAt: openItems === 0 ? returnedAt : null } });
      await tx.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.user.id, action: "RETURN", entityType: "LoanItem", entityId: loanItemId, oldData: jsonValue(item), newData: jsonValue({ item: updatedItem, daysLate: lateDays, fine: fineResult }), ipAddress: getClientIp(request) } });
      return { item: updatedItem, daysLate: lateDays, fine: fineResult };
    }, { isolationLevel: "Serializable" }));
    return NextResponse.json({ data: result }, { headers: noStoreHeaders });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "ITEM_NOT_FOUND") return errorResponse("Item peminjaman tidak ditemukan.", 404);
    if (error instanceof Error && error.message === "ALREADY_RETURNED") return errorResponse("Item sudah dikembalikan.", 409);
    if (error instanceof Error && error.message === "COPY_INVALID") return errorResponse("Status salinan tidak sesuai.", 409);
    if (error instanceof Error && error.message === "SETTINGS_NOT_FOUND") return errorResponse("Pengaturan perpustakaan belum tersedia.", 500);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
