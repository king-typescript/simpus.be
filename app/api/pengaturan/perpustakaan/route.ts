import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireLibrarian } from "@/lib/auth";

export const runtime = "nodejs";
const SETTING_KEY = "DEFAULT";
const editableFields = ["maxLoanDays", "maxActiveCopies", "fineRatePerDay"] as const;

function errorResponse(error: string, status: number) { return NextResponse.json({ error }, { status, headers: noStoreHeaders }); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function jsonValue(value: unknown) { return JSON.parse(JSON.stringify(value)); }
function validMoney(value: string) { return /^\d{1,10}(?:\.\d{1,2})?$/.test(value); }
function isTransactionConflict(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "P2034"; }
async function serializable<T>(operation: () => Promise<T>) { for (let attempt = 0; attempt < 3; attempt += 1) { try { return await operation(); } catch (error: unknown) { if (!isTransactionConflict(error) || attempt === 2) throw error; } } throw new Error("TRANSACTION_CONFLICT"); }

const select = { id: true, key: true, maxLoanDays: true, maxActiveCopies: true, fineRatePerDay: true, createdAt: true, updatedAt: true } as const;
function serialize(value: { id: string; key: string; maxLoanDays: number; maxActiveCopies: number; fineRatePerDay: Prisma.Decimal; createdAt: Date; updatedAt: Date }) {
  return { ...value, fineRatePerDay: value.fineRatePerDay.toFixed(2) };
}

export async function GET() {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  try {
    const settings = await prisma.librarySetting.findUnique({ where: { key: SETTING_KEY }, select });
    return settings ? NextResponse.json({ data: serialize(settings) }, { headers: noStoreHeaders }) : errorResponse("Pengaturan perpustakaan belum tersedia.", 500);
  } catch { return errorResponse("Terjadi kesalahan pada server.", 500); }
}

export async function PATCH(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("Body JSON tidak valid.", 400); }
  if (!isRecord(body) || Object.keys(body).some((key) => !editableFields.includes(key as (typeof editableFields)[number]))) return errorResponse("Body request tidak valid.", 422);

  const { maxLoanDays, maxActiveCopies, fineRatePerDay } = body;
  if ((maxLoanDays !== undefined && (typeof maxLoanDays !== "number" || !Number.isInteger(maxLoanDays) || maxLoanDays < 1 || maxLoanDays > 365)) || (maxActiveCopies !== undefined && (typeof maxActiveCopies !== "number" || !Number.isInteger(maxActiveCopies) || maxActiveCopies < 1 || maxActiveCopies > 100)) || (fineRatePerDay !== undefined && (typeof fineRatePerDay !== "string" || !validMoney(fineRatePerDay))) || (maxLoanDays === undefined && maxActiveCopies === undefined && fineRatePerDay === undefined)) return errorResponse("Pengaturan tidak valid.", 422);

  try {
    const settings = await serializable(() => prisma.$transaction(async (tx) => {
      const current = await tx.librarySetting.findUnique({ where: { key: SETTING_KEY }, select });
      if (!current) throw new Error("SETTINGS_NOT_FOUND");
      const updated = await tx.librarySetting.update({ where: { key: SETTING_KEY }, data: { ...(maxLoanDays !== undefined ? { maxLoanDays } : {}), ...(maxActiveCopies !== undefined ? { maxActiveCopies } : {}), ...(fineRatePerDay !== undefined ? { fineRatePerDay: new Prisma.Decimal(fineRatePerDay) } : {}) }, select });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "UPDATE", entityType: "LibrarySetting", entityId: updated.id, oldData: jsonValue(current), newData: jsonValue(updated) } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    return NextResponse.json({ data: serialize(settings) }, { headers: noStoreHeaders });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "SETTINGS_NOT_FOUND") return errorResponse("Pengaturan perpustakaan belum tersedia.", 500);
    if (isTransactionConflict(error)) return errorResponse("Permintaan konflik, coba lagi.", 409);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
