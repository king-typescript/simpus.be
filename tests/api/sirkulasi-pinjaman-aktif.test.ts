import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/app/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  librarian: vi.fn(),
  settingFindUnique: vi.fn(),
  loanFindMany: vi.fn(),
  loanCount: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ noStoreHeaders: { "Cache-Control": "no-store" }, requireLibrarian: mocks.librarian }));
vi.mock("@/lib/prisma", () => ({ prisma: { librarySetting: { findUnique: mocks.settingFindUnique }, loan: { findMany: mocks.loanFindMany, count: mocks.loanCount }, $transaction: mocks.transaction } }));

const route = await import("@/app/api/sirkulasi/pinjaman-aktif/route");

const now = new Date("2026-09-30T12:00:00.000Z");
const loanDate = new Date("2026-09-20T08:00:00.000Z");
const overdueDate = new Date("2026-09-25T08:00:00.000Z");
const activeDate = new Date("2026-10-05T08:00:00.000Z");
const librarian = { id: "11111111-1111-4111-8111-111111111111", role: "PUSTAKAWAN", status: "AKTIF" };
const studentId = "22222222-2222-4222-8222-222222222222";
const loanId = "33333333-3333-4333-8333-333333333333";
const copyId = "44444444-4444-4444-8444-444444444444";
const student = { id: studentId, nis: "20250001", name: "Budi Santoso", className: "XII IPA 1" };
const copy = { id: copyId, barcode: "COPY-001", status: "DIPINJAM", book: { id: "55555555-5555-4555-8555-555555555555", title: "Pemrograman Dasar" } };
const projectedItem = { id: "66666666-6666-4666-8666-666666666666", copyId, returnedAt: null, fine: null, copy };
const recordedFine = { id: "77777777-7777-4777-8777-777777777777", type: "KETERLAMBATAN", daysLate: 3, ratePerDay: new Prisma.Decimal("1000"), amount: new Prisma.Decimal("3000"), status: "BELUM_DIBAYAR", note: "Tercatat." };
const overdueLoan = { id: loanId, studentId, loanDate, dueDate: overdueDate, status: "AKTIF", notes: "Harap dikembalikan.", student, items: [projectedItem] };

function request(url = "http://localhost/api/sirkulasi/pinjaman-aktif") { return new Request(url); }
async function error(response: Response, status: number, message: string) { expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("no-store"); await expect(response.json()).resolves.toEqual({ error: message }); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.resetAllMocks();
  mocks.librarian.mockResolvedValue({ ok: true, user: librarian });
  mocks.settingFindUnique.mockResolvedValue({ fineRatePerDay: new Prisma.Decimal("1000") });
  mocks.loanFindMany.mockResolvedValue([]);
  mocks.loanCount.mockResolvedValue(0);
  mocks.transaction.mockImplementation(async (operations: readonly unknown[]) => Promise.all(operations));
});
afterEach(() => vi.useRealTimers());

describe("GET /api/sirkulasi/pinjaman-aktif", () => {
  it.each([401, 403])("requires librarian: %s", async status => { mocks.librarian.mockResolvedValue({ ok: false, status }); await error(await route.GET(request()), status, "Tidak memiliki akses."); expect(mocks.transaction).not.toHaveBeenCalled(); });
  it("returns empty default page and exact base queries", async () => { const response = await route.GET(request()); expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }); expect(mocks.settingFindUnique).toHaveBeenCalledWith({ where: { key: "DEFAULT" }, select: { fineRatePerDay: true } }); expect(mocks.loanFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: { in: ["AKTIF", "SEBAGIAN_DIKEMBALIKAN"] } }, skip: 0, take: 20, orderBy: [{ dueDate: "asc" }, { id: "asc" }] })); });
  it("runs exactly three transactional queries", async () => { mocks.transaction.mockImplementation(async (operations: readonly unknown[]) => { expect(operations).toHaveLength(3); return Promise.all(operations); }); await route.GET(request()); });
  it("applies student, overdue, and pagination filters", async () => { await route.GET(request(`http://localhost/api/sirkulasi/pinjaman-aktif?page=3&limit=25&studentId=${studentId}&overdue=true`)); expect(mocks.loanFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: { in: ["AKTIF", "SEBAGIAN_DIKEMBALIKAN"] }, studentId, dueDate: { lt: new Date("2026-09-30T00:00:00.000Z") } }, skip: 50, take: 25 })); });
  it("filters loans that are not overdue", async () => { await route.GET(request("http://localhost/api/sirkulasi/pinjaman-aktif?overdue=false")); expect(mocks.loanFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: { in: ["AKTIF", "SEBAGIAN_DIKEMBALIKAN"] }, dueDate: { gte: new Date("2026-09-30T00:00:00.000Z") } } })); });
  it.each(["0", "-1", "1.5", "bad"])("rejects invalid pagination %s", async value => { await error(await route.GET(request(`http://localhost/api/sirkulasi/pinjaman-aktif?page=${value}&limit=${value}`)), 422, "Parameter page tidak valid."); });
  it("rejects oversized limit and validates filters", async () => { await error(await route.GET(request("http://localhost/api/sirkulasi/pinjaman-aktif?page=2&limit=999")), 422, "Parameter limit tidak valid."); await error(await route.GET(request("http://localhost/api/sirkulasi/pinjaman-aktif?studentId=bad")), 422, "Student ID tidak valid."); await error(await route.GET(request("http://localhost/api/sirkulasi/pinjaman-aktif?overdue=yes")), 422, "Filter overdue tidak valid."); });
  it("returns projected fine for an overdue item", async () => { mocks.loanFindMany.mockResolvedValue([overdueLoan]); mocks.loanCount.mockResolvedValue(1); const body = await (await route.GET(request())).json(); expect(body.data[0]).toMatchObject({ loanId, daysLate: 5, fineSummary: { recordedCount: 0, recordedAmount: "0.00", projectedCount: 1, projectedAmount: "5000.00" }, items: [{ fineSource: "PROJECTED", fine: null, projectedFine: { daysLate: 5, ratePerDay: "1000.00", amount: "5000.00" } }] }); });
  it("uses recorded fine for overdue item instead of projection", async () => { mocks.loanFindMany.mockResolvedValue([{ ...overdueLoan, items: [{ ...projectedItem, fine: recordedFine }] }]); mocks.loanCount.mockResolvedValue(1); const body = await (await route.GET(request())).json(); expect(body.data[0]).toMatchObject({ daysLate: 5, fineSummary: { recordedCount: 1, recordedAmount: "3000.00", projectedCount: 0, projectedAmount: "0.00" }, items: [{ fineSource: "RECORDED", projectedFine: null, fine: { amount: "3000.00", ratePerDay: "1000.00" } }] }); });
  it("aggregates recorded and projected fines across items", async () => { const noFineItem = { ...projectedItem, id: "88888888-8888-4888-8888-888888888888", copy: { ...copy, id: "99999999-9999-4999-8999-999999999999" } }; mocks.loanFindMany.mockResolvedValue([{ ...overdueLoan, items: [{ ...projectedItem, fine: recordedFine }, noFineItem] }]); mocks.loanCount.mockResolvedValue(1); const body = await (await route.GET(request())).json(); expect(body.data[0].fineSummary).toEqual({ recordedCount: 1, recordedAmount: "3000.00", projectedCount: 1, projectedAmount: "5000.00" }); });
  it("returns no fine when loan is not overdue", async () => { mocks.loanFindMany.mockResolvedValue([{ ...overdueLoan, dueDate: activeDate }]); const body = await (await route.GET(request())).json(); expect(body.data[0]).toMatchObject({ daysLate: 0, fineSummary: { recordedCount: 0, recordedAmount: "0.00", projectedCount: 0, projectedAmount: "0.00" }, items: [{ fineSource: null, fine: null, projectedFine: null }] }); });
  it("maps missing settings and transaction errors", async () => { mocks.settingFindUnique.mockResolvedValue(null); await error(await route.GET(request()), 500, "Pengaturan perpustakaan belum tersedia."); mocks.settingFindUnique.mockResolvedValue({ fineRatePerDay: new Prisma.Decimal("1000") }); mocks.transaction.mockRejectedValue(new Error("DB")); await error(await route.GET(request()), 500, "Terjadi kesalahan pada server."); });
});
