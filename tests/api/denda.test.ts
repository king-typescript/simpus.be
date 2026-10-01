import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/app/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  librarian: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  rootFindUnique: vi.fn(),
  txFindUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  paymentCreate: vi.fn(),
  fineUpdate: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  noStoreHeaders: { "Cache-Control": "no-store" },
  requireLibrarian: mocks.librarian,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    fine: {
      findMany: mocks.findMany,
      count: mocks.count,
      findUnique: mocks.rootFindUnique,
    },
    $transaction: mocks.transaction,
  },
}));

const listRoute = await import("@/app/api/denda/route");
const detailRoute = await import("@/app/api/denda/[id]/route");

const librarian = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "PUSTAKAWAN",
  status: "AKTIF",
};
const fineId = "22222222-2222-4222-8222-222222222222";
const loanItemId = "33333333-3333-4333-8333-333333333333";
const date = new Date("2026-09-30T08:00:00.000Z");
const returnedAt = new Date("2026-09-28T08:00:00.000Z");
const paidAt = new Date("2026-09-30T09:00:00.000Z");
const rate = new Prisma.Decimal("1000");
const amount = new Prisma.Decimal("5000");

const listFine = {
  id: fineId,
  type: "KETERLAMBATAN",
  daysLate: 5,
  ratePerDay: rate,
  amount,
  status: "BELUM_DIBAYAR",
  note: "Terlambat.",
  createdAt: date,
  updatedAt: date,
  loanItem: {
    id: loanItemId,
    returnedAt,
    loan: {
      id: "44444444-4444-4444-8444-444444444444",
      loanDate: new Date("2026-09-20T08:00:00.000Z"),
      dueDate: new Date("2026-09-25T08:00:00.000Z"),
      returnedAt,
      student: {
        id: "55555555-5555-4555-8555-555555555555",
        nis: "20250001",
        name: "Budi Santoso",
        className: "XII IPA 1",
        libraryCardNumber: "CARD-001",
      },
    },
    copy: {
      id: "66666666-6666-4666-8666-666666666666",
      barcode: "COPY-001",
      book: { id: "77777777-7777-4777-8777-777777777777", title: "Pemrograman Dasar" },
    },
  },
  payment: null,
};

const payment = {
  id: "88888888-8888-4888-8888-888888888888",
  fineId,
  amount,
  paymentMethod: "CASH",
  receiptNumber: "KW-2026-0001",
  paidAt,
  note: "Pembayaran tunai.",
  receivedBy: { id: librarian.id, name: "Admin", username: "admin" },
};

function request(method: string, url = "http://localhost/api/denda", body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function context(id = fineId) { return { params: Promise.resolve({ id }) }; }
function valid(overrides: Record<string, unknown> = {}) { return { receiptNumber: "KW-2026-0001", amount: "5000.00", note: "Pembayaran tunai.", ...overrides }; }
async function error(response: Response, status: number, message: string) { expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("no-store"); await expect(response.json()).resolves.toEqual({ error: message }); }
function tx() { return { fine: { findUnique: mocks.txFindUnique, update: mocks.fineUpdate, findUniqueOrThrow: mocks.findUniqueOrThrow }, finePayment: { create: mocks.paymentCreate }, auditLog: { create: mocks.auditCreate } }; }
type Tx = ReturnType<typeof tx>;
type Callback = (client: Tx) => unknown | Promise<unknown>;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.librarian.mockResolvedValue({ ok: true, user: librarian });
  mocks.findMany.mockResolvedValue([listFine]);
  mocks.count.mockResolvedValue(1);
  mocks.rootFindUnique.mockResolvedValue(listFine);
  mocks.txFindUnique.mockResolvedValue(listFine);
  mocks.findUniqueOrThrow.mockResolvedValue({ ...listFine, status: "LUNAS", payment });
  mocks.paymentCreate.mockResolvedValue(payment);
  mocks.fineUpdate.mockResolvedValue({ ...listFine, status: "LUNAS" });
  mocks.auditCreate.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (operation: Callback | readonly unknown[]) => typeof operation === "function" ? operation(tx()) : Promise.all(operation));
});

describe("GET /api/denda", () => {
  it.each([401, 403])("requires librarian: %s", async status => { mocks.librarian.mockResolvedValue({ ok: false, status }); await error(await listRoute.GET(request("GET")), status, "Tidak memiliki akses."); });
  it("returns serialized fines and pagination", async () => {
    const response = await listRoute.GET(request("GET"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0]).toMatchObject({ id: fineId, ratePerDay: "1000.00", amount: "5000.00", payment: null });
    expect(body.data[0].createdAt).toBe(date.toISOString());
    expect(body.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, skip: 0, take: 20 }));
  });
  it("applies status, search, and pagination", async () => { await listRoute.GET(request("GET", "http://localhost/api/denda?page=3&limit=25&status=BELUM_DIBAYAR&search=%20Budi%20")); expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "BELUM_DIBAYAR", OR: expect.any(Array) }), skip: 50, take: 25 })); });
  it.each(["0", "-1", "1.5", "bad"])("rejects invalid pagination %s", async value => { await error(await listRoute.GET(request("GET", `http://localhost/api/denda?page=${value}&limit=${value}`)), 422, "Parameter page tidak valid."); });
  it("rejects invalid status and long search", async () => { await error(await listRoute.GET(request("GET", "http://localhost/api/denda?status=BAD")), 422, "Status denda tidak valid."); await error(await listRoute.GET(request("GET", `http://localhost/api/denda?search=${"x".repeat(101)}`)), 422, "Pencarian terlalu panjang."); });
  it("maps query failure", async () => { mocks.transaction.mockRejectedValue(new Error("DB")); await error(await listRoute.GET(request("GET")), 500, "Terjadi kesalahan pada server."); });
});

describe("GET /api/denda/[id]", () => {
  it("validates ID and returns detail", async () => { await error(await detailRoute.GET(request("GET"), context("bad")), 422, "ID denda tidak valid."); const response = await detailRoute.GET(request("GET"), context()); expect(response.status).toBe(200); const body = await response.json(); expect(body.data).toMatchObject({ id: fineId, ratePerDay: "1000.00", amount: "5000.00" }); expect(mocks.rootFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: fineId } })); });
  it("returns 404 and 500", async () => { mocks.rootFindUnique.mockResolvedValue(null); await error(await detailRoute.GET(request("GET"), context()), 404, "Denda tidak ditemukan."); mocks.rootFindUnique.mockRejectedValue(new Error("DB")); await error(await detailRoute.GET(request("GET"), context()), 500, "Terjadi kesalahan pada server."); });
});

describe("POST /api/denda/[id]", () => {
  it.each([401, 403])("requires librarian: %s", async status => { mocks.librarian.mockResolvedValue({ ok: false, status }); await error(await detailRoute.POST(request("POST", undefined, valid()), context()), status, "Tidak memiliki akses."); });
  it("allows missing origin and same origin, rejects foreign or malformed origin", async () => { expect((await detailRoute.POST(request("POST", undefined, valid()), context())).status).toBe(201); expect((await detailRoute.POST(request("POST", undefined, valid(), { origin: "http://localhost" }), context())).status).toBe(201); await error(await detailRoute.POST(request("POST", undefined, valid(), { origin: "https://evil.example" }), context()), 403, "Origin tidak diizinkan."); await error(await detailRoute.POST(request("POST", undefined, valid(), { origin: "not-a-url" }), context()), 403, "Origin tidak diizinkan."); });
  it("validates ID, malformed JSON, and body shape", async () => { await error(await detailRoute.POST(request("POST", undefined, valid()), context("bad")), 422, "ID denda tidak valid."); const malformed = new Request("http://localhost/api/denda/id", { method: "POST", body: "{" }); await error(await detailRoute.POST(malformed, context()), 400, "Body JSON tidak valid."); for (const body of [null, [], "x", 1, { ...valid(), extra: true }]) await error(await detailRoute.POST(request("POST", undefined, body), context()), 422, "Body request tidak valid."); });
  it.each([valid({ receiptNumber: "" }), valid({ receiptNumber: "x".repeat(101) }), valid({ amount: "5000.123" }), valid({ amount: "-1" }), valid({ note: 1 }), valid({ note: "x".repeat(1001) })])("rejects invalid payment data", async body => { await error(await detailRoute.POST(request("POST", undefined, body), context()), 422, "Data pembayaran tidak valid."); });
  it("accepts null and blank note", async () => { expect((await detailRoute.POST(request("POST", undefined, valid({ note: null })), context())).status).toBe(201); expect((await detailRoute.POST(request("POST", undefined, valid({ note: " " })), context())).status).toBe(201); expect(mocks.paymentCreate).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ note: null }) })); });
  it("maps business errors", async () => { for (const [fine, status, message] of [[null, 404, "Denda tidak ditemukan."], [{ ...listFine, status: "LUNAS" }, 409, "Denda sudah diselesaikan."], [{ ...listFine, payment }, 409, "Pembayaran denda sudah tercatat."], [{ ...listFine, loanItem: { ...listFine.loanItem, returnedAt: null } }, 422, "Denda belum dapat dibayar sebelum buku dikembalikan."]] as const) { mocks.txFindUnique.mockResolvedValue(fine); await error(await detailRoute.POST(request("POST", undefined, valid()), context()), status, message); } });
  it("rejects amount mismatch", async () => { await error(await detailRoute.POST(request("POST", undefined, valid({ amount: "4000" })), context()), 422, "Nominal pembayaran harus sama dengan nominal denda."); expect(mocks.paymentCreate).not.toHaveBeenCalled(); });
  it("creates payment, updates fine, and audits serialized state", async () => { const response = await detailRoute.POST(request("POST", undefined, valid()), context()); expect(response.status).toBe(201); const body = await response.json(); expect(body.data.payment).toMatchObject({ amount: "5000.00", receiptNumber: "KW-2026-0001", note: "Pembayaran tunai." }); expect(body.data.payment.paidAt).toBe(paidAt.toISOString()); expect(mocks.paymentCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ receivedById: librarian.id, amount: expect.any(Prisma.Decimal), paymentMethod: "CASH", receiptNumber: "KW-2026-0001", note: "Pembayaran tunai." }) })); expect(mocks.fineUpdate).toHaveBeenCalledWith({ where: { id: fineId }, data: { status: "LUNAS" } }); expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: librarian.id, action: "PAYMENT", entityType: "Fine", entityId: fineId, oldData: expect.objectContaining({ id: fineId, status: "BELUM_DIBAYAR" }), newData: expect.objectContaining({ id: fineId }) }) }); });
  it("uses serializable transaction and retries conflicts", async () => { const options: unknown[] = []; let attempts = 0; mocks.transaction.mockImplementation(async (...args: unknown[]) => { options.push(args[1]); attempts += 1; if (attempts < 3) throw Object.assign(new Error("conflict"), { code: "P2034" }); return (args[0] as Callback)(tx()); }); expect((await detailRoute.POST(request("POST", undefined, valid()), context())).status).toBe(201); expect(attempts).toBe(3); expect(options).toEqual([{ isolationLevel: "Serializable" }, { isolationLevel: "Serializable" }, { isolationLevel: "Serializable" }]); });
  it("maps final conflict, duplicate receipt, and unexpected errors", async () => { mocks.transaction.mockRejectedValue(Object.assign(new Error("conflict"), { code: "P2034" })); await error(await detailRoute.POST(request("POST", undefined, valid()), context()), 409, "Permintaan konflik, coba lagi."); mocks.transaction.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "P2002" })); await error(await detailRoute.POST(request("POST", undefined, valid()), context()), 409, "Nomor kuitansi sudah digunakan."); mocks.transaction.mockRejectedValue(new Error("DB")); await error(await detailRoute.POST(request("POST", undefined, valid()), context()), 500, "Terjadi kesalahan pada server."); });
});
