import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/app/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  librarian: vi.fn(),
  rootFindUnique: vi.fn(),
  txFindUnique: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  noStoreHeaders: { "Cache-Control": "no-store" },
  requireLibrarian: mocks.librarian,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    librarySetting: {
      findUnique: mocks.rootFindUnique,
      update: mocks.update,
    },
    $transaction: mocks.transaction,
  },
}));

const route = await import("@/app/api/pengaturan/perpustakaan/route");

const librarian = { id: "11111111-1111-4111-8111-111111111111", role: "PUSTAKAWAN", status: "AKTIF" };
const settingId = "22222222-2222-4222-8222-222222222222";
const createdAt = new Date("2026-09-30T08:00:00.000Z");
const updatedAt = new Date("2026-09-30T09:00:00.000Z");
const setting = { id: settingId, key: "DEFAULT", maxLoanDays: 14, maxActiveCopies: 3, fineRatePerDay: new Prisma.Decimal("1000"), createdAt, updatedAt };
const updated = { ...setting, maxLoanDays: 21, maxActiveCopies: 5, fineRatePerDay: new Prisma.Decimal("1500.50") };
const select = { id: true, key: true, maxLoanDays: true, maxActiveCopies: true, fineRatePerDay: true, createdAt: true, updatedAt: true } as const;

function request(body?: unknown) { return new Request("http://localhost/api/pengaturan/perpustakaan", { method: "PATCH", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
async function error(response: Response, status: number, message: string) { expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("no-store"); await expect(response.json()).resolves.toEqual({ error: message }); }
function tx() { return { librarySetting: { findUnique: mocks.txFindUnique, update: mocks.update }, auditLog: { create: mocks.audit } }; }
type Tx = ReturnType<typeof tx>;
type Callback = (client: Tx) => unknown | Promise<unknown>;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.librarian.mockResolvedValue({ ok: true, user: librarian });
  mocks.rootFindUnique.mockResolvedValue(setting);
  mocks.txFindUnique.mockResolvedValue(setting);
  mocks.update.mockResolvedValue(updated);
  mocks.audit.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (operation: Callback) => operation(tx()));
});

describe("GET /api/pengaturan/perpustakaan", () => {
  it.each([401, 403])("requires librarian: %s", async status => { mocks.librarian.mockResolvedValue({ ok: false, status }); await error(await route.GET(), status, "Tidak memiliki akses."); expect(mocks.rootFindUnique).not.toHaveBeenCalled(); });
  it("returns settings with serialized money and dates", async () => { const response = await route.GET(); expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual({ data: { ...setting, fineRatePerDay: "1000.00", createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() } }); expect(mocks.rootFindUnique).toHaveBeenCalledWith({ where: { key: "DEFAULT" }, select }); });
  it("serializes decimal values with two digits", async () => { mocks.rootFindUnique.mockResolvedValue({ ...setting, fineRatePerDay: new Prisma.Decimal("1500.5") }); await expect((await route.GET()).json()).resolves.toMatchObject({ data: { fineRatePerDay: "1500.50" } }); });
  it("maps missing and database errors", async () => { mocks.rootFindUnique.mockResolvedValue(null); await error(await route.GET(), 500, "Pengaturan perpustakaan belum tersedia."); mocks.rootFindUnique.mockRejectedValue(new Error("DB")); await error(await route.GET(), 500, "Terjadi kesalahan pada server."); });
});

describe("PATCH /api/pengaturan/perpustakaan", () => {
  it.each([401, 403])("requires librarian: %s", async status => { mocks.librarian.mockResolvedValue({ ok: false, status }); await error(await route.PATCH(request({ maxLoanDays: 21 })), status, "Tidak memiliki akses."); });
  it("rejects malformed JSON and invalid shapes", async () => { const malformed = new Request("http://localhost/api/pengaturan/perpustakaan", { method: "PATCH", body: "{" }); await error(await route.PATCH(malformed), 400, "Body JSON tidak valid."); for (const body of [null, [], "x", 1, { maxLoanDays: 21, extra: true }]) await error(await route.PATCH(request(body)), 422, "Body request tidak valid."); });
  it.each([{}, { maxLoanDays: 0 }, { maxLoanDays: 366 }, { maxLoanDays: 1.5 }, { maxLoanDays: "21" }, { maxActiveCopies: 0 }, { maxActiveCopies: 101 }, { maxActiveCopies: 1.5 }, { maxActiveCopies: "5" }, { fineRatePerDay: "" }, { fineRatePerDay: "-1" }, { fineRatePerDay: "1000.123" }, { fineRatePerDay: 1000 }])("rejects invalid settings: %j", async body => { await error(await route.PATCH(request(body)), 422, "Pengaturan tidak valid."); expect(mocks.transaction).not.toHaveBeenCalled(); });
  it("updates partial settings and returns serialized response", async () => { const response = await route.PATCH(request({ maxLoanDays: 21 })); expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual({ data: { ...updated, fineRatePerDay: "1500.50", createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() } }); expect(mocks.update).toHaveBeenCalledWith({ where: { key: "DEFAULT" }, data: { maxLoanDays: 21 }, select }); });
  it("updates fine rate as Decimal", async () => { await route.PATCH(request({ fineRatePerDay: "1500.50" })); const call = mocks.update.mock.calls[0][0]; expect(call.data.fineRatePerDay).toBeInstanceOf(Prisma.Decimal); expect(call.data.fineRatePerDay.toString()).toBe("1500.5"); });
  it("writes audit log with old and new data", async () => { await route.PATCH(request({ maxLoanDays: 21 })); expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: librarian.id, action: "UPDATE", entityType: "LibrarySetting", entityId: settingId, oldData: expect.objectContaining({ id: settingId, maxLoanDays: 14 }), newData: expect.objectContaining({ id: settingId, maxLoanDays: 21 }) }) }); });
  it("maps missing settings", async () => { mocks.txFindUnique.mockResolvedValue(null); await error(await route.PATCH(request({ maxLoanDays: 21 })), 500, "Pengaturan perpustakaan belum tersedia."); expect(mocks.update).not.toHaveBeenCalled(); });
  it("uses serializable transaction and retries P2034 three times", async () => { let attempts = 0; let callbacks = 0; const options: unknown[] = []; mocks.transaction.mockImplementation(async (...args: unknown[]) => { options.push(args[1]); attempts += 1; callbacks += 1; if (attempts < 3) throw Object.assign(new Error("conflict"), { code: "P2034" }); return (args[0] as Callback)(tx()); }); expect((await route.PATCH(request({ maxLoanDays: 21 }))).status).toBe(200); expect(attempts).toBe(3); expect(callbacks).toBe(3); expect(options).toEqual([{ isolationLevel: "Serializable" }, { isolationLevel: "Serializable" }, { isolationLevel: "Serializable" }]); });
  it("maps final conflict and database errors", async () => { mocks.transaction.mockRejectedValue(Object.assign(new Error("conflict"), { code: "P2034" })); await error(await route.PATCH(request({ maxLoanDays: 21 })), 409, "Permintaan konflik, coba lagi."); mocks.transaction.mockRejectedValue(new Error("DB")); await error(await route.PATCH(request({ maxLoanDays: 21 })), 500, "Terjadi kesalahan pada server."); });
});
