import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/app/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  requireLibrarian: vi.fn(),
  findItem: vi.fn(),
  findSetting: vi.fn(),
  findFine: vi.fn(),
  updateItem: vi.fn(),
  createFine: vi.fn(),
  updateFine: vi.fn(),
  countOpenItems: vi.fn(),
  countReturnedItems: vi.fn(),
  updateLoan: vi.fn(),
  createAuditLog: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  noStoreHeaders: { "Cache-Control": "no-store" },
  requireLibrarian: mocks.requireLibrarian,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

vi.mock("@/lib/fine", () => ({
  calculateDaysLate: (dueDate: Date, referenceDate: Date) => {
    const due = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
    const reference = Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate());
    return Math.max(0, Math.ceil((reference - due) / 86_400_000));
  },
  calculateFine: (daysLate: number, rate: Prisma.Decimal) => rate.mul(daysLate),
}));

const { POST } = await import("@/app/api/sirkulasi/kembali/route");

const librarian = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "PUSTAKAWAN" as const,
  status: "AKTIF" as const,
};
const loanItemId = "22222222-2222-4222-8222-222222222222";
const loanId = "33333333-3333-4333-8333-333333333333";
const copyId = "44444444-4444-4444-8444-444444444444";
const fineId = "55555555-5555-4555-8555-555555555555";
const fixedNow = new Date("2026-09-30T08:00:00.000Z");
const overdueDate = new Date("2026-09-27T08:00:00.000Z");
const settings = { fineRatePerDay: new Prisma.Decimal("1500") };

const activeItem = {
  id: loanItemId,
  loanId,
  copyId,
  returnedAt: null,
  returnCondition: null,
  returnNote: null,
  loan: { id: loanId, dueDate: overdueDate, status: "AKTIF" },
  copy: { id: copyId, status: "DIPINJAM", isActive: true },
};

const updatedItem = {
  id: loanItemId,
  loanId,
  copyId,
  returnedAt: fixedNow,
  returnCondition: "Baik",
  returnNote: "Tidak ada catatan",
  copy: { id: copyId, barcode: "BK-001", status: "TERSEDIA" },
};

function requestWithBody(body: unknown) {
  return new Request("http://localhost/api/sirkulasi/kembali", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectJsonError(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ error });
}

function transactionClient() {
  return {
    loanItem: { findUnique: mocks.findItem, update: mocks.updateItem },
    librarySetting: { findUnique: mocks.findSetting },
    fine: { findUnique: mocks.findFine, create: mocks.createFine, update: mocks.updateFine },
    loan: { update: mocks.updateLoan },
    loanItemCount: undefined,
    auditLog: { create: mocks.createAuditLog },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(fixedNow);
  vi.resetAllMocks();

  mocks.requireLibrarian.mockResolvedValue({ ok: true, user: librarian });
  mocks.findItem.mockResolvedValue(activeItem);
  mocks.findSetting.mockResolvedValue(settings);
  mocks.findFine.mockResolvedValue(null);
  mocks.updateItem.mockResolvedValue(updatedItem);
  mocks.createFine.mockResolvedValue({
    id: fineId,
    daysLate: 3,
    ratePerDay: settings.fineRatePerDay,
    amount: new Prisma.Decimal("4500"),
    status: "BELUM_DIBAYAR",
  });
  mocks.updateFine.mockResolvedValue({});
  mocks.countOpenItems.mockResolvedValue(0);
  mocks.countReturnedItems.mockResolvedValue(1);
  mocks.updateLoan.mockResolvedValue({});
  mocks.createAuditLog.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (callback: Function) =>
    callback({
      ...transactionClient(),
      loanItem: {
        ...transactionClient().loanItem,
        count: ({ where }: { where: { returnedAt: null | { not: null } } }) =>
          where.returnedAt === null ? mocks.countOpenItems() : mocks.countReturnedItems(),
      },
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/sirkulasi/kembali", () => {
  it.each([401, 403])("returns %s when user lacks librarian access", async (status) => {
    mocks.requireLibrarian.mockResolvedValue({ ok: false, status });

    await expectJsonError(
      await POST(requestWithBody({ loanItemId, status: "TERSEDIA" })),
      status,
      "Tidak memiliki akses.",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const request = new Request("http://localhost/api/sirkulasi/kembali", {
      method: "POST",
      body: "{invalid-json",
    });

    await expectJsonError(await POST(request), 400, "Body JSON tidak valid.");
  });

  it.each([
    null,
    [],
    "invalid-body",
    { loanItemId: "invalid-id", status: "TERSEDIA" },
    { loanItemId, status: "INVALID_STATUS" },
    { loanItemId, status: "TERSEDIA", unexpected: true },
    { loanItemId, status: "RUSAK", returnCondition: 123 },
    { loanItemId, status: "TERSEDIA", returnCondition: "x".repeat(1001) },
    { loanItemId, status: "TERSEDIA", returnNote: "x".repeat(1001) },
  ])("returns 422 for invalid request: %j", async (body) => {
    const structural = body === null || Array.isArray(body) || typeof body !== "object" ||
      (body !== null && typeof body === "object" && "unexpected" in body);
    const missingCondition = body !== null && typeof body === "object" &&
      "status" in body && body.status === "RUSAK" &&
      !("returnCondition" in body);
    await expectJsonError(
      await POST(requestWithBody(body)),
      422,
      structural
        ? "Body request tidak valid."
        : missingCondition
          ? "Kondisi pengembalian wajib diisi."
          : "Data pengembalian tidak valid.",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("requires condition for damaged or lost copy", async () => {
    for (const status of ["RUSAK", "HILANG"] as const) {
      await expectJsonError(
        await POST(requestWithBody({ loanItemId, status })),
        422,
        "Kondisi pengembalian wajib diisi.",
      );
    }
  });

  it("returns 404 when item does not exist", async () => {
    mocks.findItem.mockResolvedValue(null);
    await expectJsonError(
      await POST(requestWithBody({ loanItemId, status: "TERSEDIA" })),
      404,
      "Item peminjaman tidak ditemukan.",
    );
  });

  it.each(["SELESAI", "DIBATALKAN"])("returns 409 for loan status %s", async (status) => {
    mocks.findItem.mockResolvedValue({ ...activeItem, loan: { ...activeItem.loan, status } });
    await expectJsonError(
      await POST(requestWithBody({ loanItemId, status: "TERSEDIA" })),
      409,
      "Item sudah dikembalikan.",
    );
  });

  it.each([
    { ...activeItem, copy: { ...activeItem.copy, status: "TERSEDIA" } },
    { ...activeItem, copy: { ...activeItem.copy, isActive: false } },
  ])("returns 409 for invalid copy state", async (item) => {
    mocks.findItem.mockResolvedValue(item);
    await expectJsonError(
      await POST(requestWithBody({ loanItemId, status: "TERSEDIA" })),
      409,
      "Status salinan tidak sesuai.",
    );
  });

  it("returns 500 when settings are missing", async () => {
    mocks.findSetting.mockResolvedValue(null);
    await expectJsonError(
      await POST(requestWithBody({ loanItemId, status: "TERSEDIA" })),
      500,
      "Pengaturan perpustakaan belum tersedia.",
    );
  });

  it("retries P2034 three times and returns 409", async () => {
    let attempts = 0;
    const calls: unknown[][] = [];
    mocks.transaction.mockImplementation(async (...args: unknown[]) => {
      calls.push(args);
      attempts += 1;
      throw Object.assign(new Error("serialization conflict"), { code: "P2034" });
    });

    await expectJsonError(
      await POST(requestWithBody({ loanItemId, status: "TERSEDIA" })),
      409,
      "Permintaan konflik, coba lagi.",
    );
    expect(attempts).toBe(3);
    expect(calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });

  it("creates overdue fine and completes loan", async () => {
    const response = await POST(
      requestWithBody({
        loanItemId,
        status: "TERSEDIA",
        returnCondition: "  Baik  ",
        returnNote: "  Tidak ada catatan  ",
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      item: { id: loanItemId, returnCondition: "Baik", returnNote: "Tidak ada catatan" },
      daysLate: 3,
      fine: { daysLate: 3, ratePerDay: "1500.00", amount: "4500.00" },
    });
    expect(mocks.createFine).toHaveBeenCalled();
    expect(mocks.updateItem).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: loanItemId },
      data: expect.objectContaining({
        returnedAt: expect.any(Date),
        returnCondition: "Baik",
        returnNote: "Tidak ada catatan",
      }),
    }));
    expect(mocks.updateLoan).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: loanId },
      data: expect.objectContaining({ status: "SELESAI", returnedAt: expect.any(Date) }),
    }));
  });

  it("updates an existing unpaid fine", async () => {
    mocks.findFine.mockResolvedValue({
      id: fineId,
      type: "LATE",
      daysLate: 1,
      ratePerDay: settings.fineRatePerDay,
      amount: new Prisma.Decimal("1500"),
      status: "BELUM_DIBAYAR",
      note: null,
    });

    await POST(requestWithBody({ loanItemId, status: "TERSEDIA" }));

    expect(mocks.updateFine).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: fineId },
      data: expect.objectContaining({ daysLate: 3, amount: new Prisma.Decimal("4500") }),
    }));
    expect(mocks.createFine).not.toHaveBeenCalled();
  });

  it("does not update a paid fine", async () => {
    mocks.findFine.mockResolvedValue({
      id: fineId,
      type: "LATE",
      daysLate: 3,
      ratePerDay: settings.fineRatePerDay,
      amount: new Prisma.Decimal("4500"),
      status: "LUNAS",
      note: null,
    });

    const response = await POST(requestWithBody({ loanItemId, status: "TERSEDIA" }));

    expect(response.status).toBe(200);
    expect(mocks.createFine).not.toHaveBeenCalled();
    expect(mocks.updateFine).not.toHaveBeenCalled();
  });

  it("does not create fine when returned on time", async () => {
    mocks.findItem.mockResolvedValue({
      ...activeItem,
      loan: { ...activeItem.loan, dueDate: new Date("2026-10-01T08:00:00.000Z") },
    });

    const response = await POST(requestWithBody({ loanItemId, status: "TERSEDIA" }));

    expect(response.status).toBe(200);
    expect((await response.json()).data.fine).toBeNull();
    expect(mocks.createFine).not.toHaveBeenCalled();
  });
});
