import { NextResponse } from "next/server";
import { BookStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireLibrarian } from "@/lib/auth";
import { calculateDaysLate, calculateFine } from "@/lib/fine";

export const runtime = "nodejs";
const SETTING_KEY = "DEFAULT";
const returnStatuses = ["TERSEDIA", "RUSAK", "HILANG"] as const;
type ReturnStatus = (typeof returnStatuses)[number];
function errorResponse(error: string, status: number) { return NextResponse.json({ error }, { status, headers: noStoreHeaders }); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function uuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function jsonValue(value: unknown) { return JSON.parse(JSON.stringify(value)); }
async function serializable<T>(operation: () => Promise<T>) { for (let attempt = 0; attempt < 3; attempt += 1) { try { return await operation(); } catch (error: unknown) { const conflict = typeof error === "object" && error !== null && "code" in error && error.code === "P2034"; if (!conflict || attempt === 2) throw error; } } throw new Error("TRANSACTION_CONFLICT"); }

export async function POST(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("Body JSON tidak valid.", 400); }
  if (!record(body) || Object.keys(body).some((key) => !["loanItemId", "status", "returnCondition", "returnNote"].includes(key))) return errorResponse("Body request tidak valid.", 422);
  const loanItemId = body.loanItemId;
  const status = body.status;
  const returnCondition = body.returnCondition === undefined || body.returnCondition === null ? null : typeof body.returnCondition === "string" ? body.returnCondition.trim() || null : undefined;
  const returnNote = body.returnNote === undefined || body.returnNote === null ? null : typeof body.returnNote === "string" ? body.returnNote.trim() || null : undefined;
  if (!uuid(loanItemId) || !returnStatuses.includes(status as ReturnStatus) || returnCondition === undefined || returnNote === undefined || (returnCondition !== null && returnCondition.length > 1000) || (returnNote !== null && returnNote.length > 1000)) return errorResponse("Data pengembalian tidak valid.", 422);
  if ((status === "RUSAK" || status === "HILANG") && !returnCondition) return errorResponse("Kondisi pengembalian wajib diisi.", 422);

  try {
    const result = await serializable(() => prisma.$transaction(async (tx) => {
      const item = await tx.loanItem.findUnique({ where: { id: loanItemId }, select: { id: true, loanId: true, copyId: true, returnedAt: true, returnCondition: true, returnNote: true, loan: { select: { id: true, dueDate: true, status: true } }, copy: { select: { id: true, status: true, isActive: true } } } });
      if (!item) throw new Error("ITEM_NOT_FOUND");
      if (item.returnedAt || item.loan.status === "SELESAI" || item.loan.status === "DIBATALKAN") throw new Error("ALREADY_RETURNED");
      if (!item.copy.isActive || item.copy.status !== "DIPINJAM") throw new Error("COPY_INVALID");
      const settings = await tx.librarySetting.findUnique({ where: { key: SETTING_KEY }, select: { fineRatePerDay: true } });
      if (!settings) throw new Error("SETTINGS_NOT_FOUND");
      const returnedAt = new Date();
      const lateDays = calculateDaysLate(item.loan.dueDate, returnedAt);
      const amount = calculateFine(lateDays, settings.fineRatePerDay);
      const existingFine = await tx.fine.findUnique({ where: { loanItemId }, select: { id: true, type: true, daysLate: true, ratePerDay: true, amount: true, status: true, note: true } });
      const updatedItem = await tx.loanItem.update({ where: { id: loanItemId }, data: { returnedAt, returnCondition, returnNote, copy: { update: { status: status as BookStatus, conditionNote: returnCondition } } }, select: { id: true, loanId: true, copyId: true, returnedAt: true, returnCondition: true, returnNote: true, copy: { select: { id: true, barcode: true, status: true } } } });
      let fineResult: { daysLate: number; ratePerDay: string; amount: string } | null = null;
      if (lateDays > 0) {
        if (!existingFine) {
          const fine = await tx.fine.create({ data: { loanItemId, daysLate: lateDays, ratePerDay: settings.fineRatePerDay, amount, status: "BELUM_DIBAYAR", note: `Denda keterlambatan ${lateDays} hari.` }, select: { id: true, daysLate: true, ratePerDay: true, amount: true, status: true } });
          await tx.auditLog.create({ data: { userId: auth.user.id, action: "CREATE", entityType: "Fine", entityId: fine.id, newData: jsonValue(fine) } });
          fineResult = { daysLate: fine.daysLate, ratePerDay: fine.ratePerDay.toFixed(2), amount: fine.amount.toFixed(2) };
        } else if (existingFine.status === "BELUM_DIBAYAR") {
          const updatedAmount = existingFine.ratePerDay.mul(lateDays);
          const fine = await tx.fine.update({ where: { id: existingFine.id }, data: { daysLate: lateDays, amount: updatedAmount, note: `Denda keterlambatan ${lateDays} hari.` }, select: { id: true, daysLate: true, ratePerDay: true, amount: true, status: true } });
          await tx.auditLog.create({ data: { userId: auth.user.id, action: "UPDATE", entityType: "Fine", entityId: fine.id, oldData: jsonValue(existingFine), newData: jsonValue(fine) } });
          fineResult = { daysLate: fine.daysLate, ratePerDay: fine.ratePerDay.toFixed(2), amount: fine.amount.toFixed(2) };
        } else {
          fineResult = { daysLate: existingFine.daysLate, ratePerDay: existingFine.ratePerDay.toFixed(2), amount: existingFine.amount.toFixed(2) };
        }
      }
      const openItems = await tx.loanItem.count({ where: { loanId: item.loanId, returnedAt: null } });
      const returnedItems = await tx.loanItem.count({ where: { loanId: item.loanId, returnedAt: { not: null } } });
      await tx.loan.update({ where: { id: item.loanId }, data: { status: openItems === 0 ? "SELESAI" : returnedItems > 0 ? "SEBAGIAN_DIKEMBALIKAN" : "AKTIF", returnedAt: openItems === 0 ? returnedAt : null } });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "RETURN", entityType: "LoanItem", entityId: loanItemId, oldData: jsonValue(item), newData: jsonValue({ item: updatedItem, daysLate: lateDays, fine: fineResult }) } });
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
