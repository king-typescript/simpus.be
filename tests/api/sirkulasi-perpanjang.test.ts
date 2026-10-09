import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireLibrarian: vi.fn(),
  findLoan: vi.fn(),
  countRenewals: vi.fn(),
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

const { POST } = await import("@/app/api/sirkulasi/perpanjang/route");

const librarian = { id: "11111111-1111-4111-8111-111111111111", role: "PUSTAKAWAN", status: "AKTIF" };
const schoolId = "22222222-2222-4222-8222-222222222222";
const loanId = "33333333-3333-4333-8333-333333333333";
const dueDate = new Date("2026-10-01T00:00:00.000Z");

function tx() {
  return {
    loan: { findUnique: mocks.findLoan, update: mocks.updateLoan },
    auditLog: { count: mocks.countRenewals, create: mocks.createAuditLog },
  };
}
type Tx = ReturnType<typeof tx>;
type Callback = (client: Tx) => unknown | Promise<unknown>;

function req(body: unknown, contentType = "application/json") {
  return new Request("http://localhost/api/sirkulasi/perpanjang", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: JSON.stringify(body),
  });
}

async function error(response: Response, status: number, message: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ error: message });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireLibrarian.mockResolvedValue({ ok: true, user: librarian, schoolId });
  mocks.findLoan.mockResolvedValue({
    id: loanId,
    dueDate,
    status: "AKTIF",
    notes: null,
    items: [{ id: "55555555-5555-4555-8555-555555555555", returnedAt: null }],
  });
  mocks.countRenewals.mockResolvedValue(0);
  mocks.updateLoan.mockResolvedValue({ id: loanId, dueDate: new Date("2026-10-08T00:00:00.000Z"), status: "AKTIF", notes: null });
  mocks.createAuditLog.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (operation: Callback | readonly unknown[]) =>
    typeof operation === "function" ? operation(tx()) : Promise.all(operation),
  );
});

describe("POST /api/sirkulasi/perpanjang", () => {
  it("requires librarian access", async () => {
    mocks.requireLibrarian.mockResolvedValue({ ok: false, status: 401 });
    await error(await POST(req({ loanId, additionalDays: 3 })), 401, "Tidak memiliki akses.");
  });

  it("rejects non-JSON content type", async () => {
    await error(await POST(req({ loanId, additionalDays: 3 }, "text/plain")), 415, "Content-Type harus application/json.");
  });

  it("rejects invalid body and loan id", async () => {
    await error(await POST(new Request("http://localhost/api/sirkulasi/perpanjang", { method: "POST", headers: { "Content-Type": "application/json" }, body: "not-json" })), 400, "Body JSON tidak valid.");
    await error(await POST(req({ foo: 1 })), 422, "Body request tidak valid.");
    await error(await POST(req({ loanId: "bad", additionalDays: 3 })), 422, "Loan ID tidak valid.");
    await error(await POST(req({ loanId, additionalDays: 0 })), 422, "Jumlah hari perpanjangan tidak valid.");
    await error(await POST(req({ loanId, additionalDays: 8 })), 422, "Jumlah hari perpanjangan tidak valid.");
  });

  it("renews a loan by extending due date and writes audit log", async () => {
    const response = await POST(req({ loanId, additionalDays: 7, notes: " Disetujui dosen. " }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        loanId,
        oldDueDate: "2026-10-01T00:00:00.000Z",
        dueDate: "2026-10-08T00:00:00.000Z",
        renewalCount: 1,
        maxRenewalCount: 1,
        status: "AKTIF",
        notes: null,
      },
    });
    expect(mocks.updateLoan).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: loanId, schoolId },
        data: { dueDate: new Date("2026-10-08T00:00:00.000Z"), notes: "Disetujui dosen." },
      }),
    );
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "RENEW", entityType: "Loan", entityId: loanId, schoolId }) }),
    );
  });

  it("maps not found, non-renewable, returned, and renewal limit errors", async () => {
    mocks.findLoan.mockResolvedValue(null);
    await error(await POST(req({ loanId, additionalDays: 3 })), 404, "Pinjaman tidak ditemukan.");

    mocks.findLoan.mockResolvedValue({ id: loanId, dueDate, status: "SELESAI", notes: null, items: [{ id: "55555555-5555-4555-8555-555555555555", returnedAt: null }] });
    await error(await POST(req({ loanId, additionalDays: 3 })), 422, "Pinjaman sudah selesai atau dibatalkan.");

    mocks.findLoan.mockResolvedValue({ id: loanId, dueDate, status: "AKTIF", notes: null, items: [{ id: "55555555-5555-4555-8555-555555555555", returnedAt: dueDate }] });
    await error(await POST(req({ loanId, additionalDays: 3 })), 422, "Semua buku dalam pinjaman sudah dikembalikan.");

    mocks.findLoan.mockResolvedValue({ id: loanId, dueDate, status: "AKTIF", notes: null, items: [{ id: "55555555-5555-4555-8555-555555555555", returnedAt: null }] });
    mocks.countRenewals.mockResolvedValue(1);
    await error(await POST(req({ loanId, additionalDays: 3 })), 409, "Batas perpanjangan pinjaman sudah tercapai.");
  });

  it("maps serializable conflict to 409", async () => {
    mocks.transaction.mockRejectedValue(Object.assign(new Error("conflict"), { code: "P2034" }));
    await error(await POST(req({ loanId, additionalDays: 3 })), 409, "Data berubah bersamaan. Silakan coba lagi.");
  });

  it("retries serializable conflicts up to three times", async () => {
    let attempts = 0;
    mocks.transaction.mockImplementation(async (...args: unknown[]) => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("conflict"), { code: "P2034" });
      return (args[0] as Callback)(tx());
    });
    const response = await POST(req({ loanId, additionalDays: 3 }));
    expect(response.status).toBe(200);
    expect(attempts).toBe(3);
  });

  it("returns 500 on unexpected errors", async () => {
    mocks.transaction.mockRejectedValue(new Error("database unavailable"));
    await error(await POST(req({ loanId, additionalDays: 3 })), 500, "Terjadi kesalahan pada server.");
  });
});
