import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/app/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  bookCount: vi.fn(),
  copyCount: vi.fn(),
  studentCount: vi.fn(),
  loanCount: vi.fn(),
  loanFindMany: vi.fn(),
  fineAggregate: vi.fn(),
  fineCount: vi.fn(),
  paymentFindMany: vi.fn(),
  studentFindFirst: vi.fn(),
  fineFindMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  noStoreHeaders: { "Cache-Control": "no-store" },
  requireAuthenticatedUser: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    book: { count: mocks.bookCount },
    bookCopy: { count: mocks.copyCount },
    student: { count: mocks.studentCount, findFirst: mocks.studentFindFirst },
    loan: { count: mocks.loanCount, findMany: mocks.loanFindMany },
    fine: { aggregate: mocks.fineAggregate, count: mocks.fineCount, findMany: mocks.fineFindMany },
    finePayment: { findMany: mocks.paymentFindMany },
    $transaction: mocks.transaction,
  },
}));

const route = await import("@/app/api/dashboard/route");

const now = new Date("2026-09-30T08:00:00.000Z");
const loanDate = new Date("2026-09-20T08:00:00.000Z");
const dueDate = new Date("2026-09-25T08:00:00.000Z");
const paymentDate = new Date("2026-09-29T08:00:00.000Z");

const librarian = { id: "11111111-1111-4111-8111-111111111111", role: "PUSTAKAWAN", status: "AKTIF" };
const studentUser = { id: "22222222-2222-4222-8222-222222222222", role: "SISWA", status: "AKTIF" };
const student = { id: "33333333-3333-4333-8333-333333333333", nis: "20250001", name: "Budi Santoso", className: "XII IPA 1", libraryCardNumber: "CARD-001", phone: "08123456789" };

const loan = {
  id: "44444444-4444-4444-8444-444444444444",
  loanDate,
  dueDate,
  returnedAt: null,
  status: "AKTIF",
  student: { id: student.id, nis: student.nis, name: student.name, className: student.className },
  items: [{ id: "55555555-5555-4555-8555-555555555555", returnedAt: null, copy: { barcode: "COPY-001", book: { id: "66666666-6666-4666-8666-666666666666", title: "Pemrograman Dasar" } } }],
};

const studentLoan = {
  id: "77777777-7777-4777-8777-777777777777",
  loanDate,
  dueDate,
  returnedAt: null,
  status: "AKTIF",
  notes: "Harap dikembalikan.",
  items: [{ id: "88888888-8888-4888-8888-888888888888", copyId: "99999999-9999-4999-8999-999999999999", returnedAt: null, copy: { id: "99999999-9999-4999-8999-999999999999", barcode: "COPY-001", book: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Pemrograman Dasar", publisher: "Penerbit", coverUrl: "https://example.com/cover.jpg" } } }],
};

const fine = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  type: "KETERLAMBATAN",
  daysLate: 5,
  ratePerDay: new Prisma.Decimal("1000"),
  amount: new Prisma.Decimal("5000"),
  status: "BELUM_DIBAYAR",
  note: "Terlambat.",
  createdAt: now,
  loanItem: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", returnedAt: null, copy: { barcode: "COPY-001", book: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Pemrograman Dasar" } }, loan: { loanDate, dueDate, returnedAt: null } },
  payment: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", amount: new Prisma.Decimal("0") },
};

const payment = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  amount: new Prisma.Decimal("5000"),
  paymentMethod: "CASH",
  receiptNumber: "KW-2026-0001",
  paidAt: paymentDate,
  note: "Tunai.",
  receivedBy: { id: librarian.id, name: "Admin", username: "admin" },
  fine: { id: fine.id, loanItem: { loan: { student: { id: student.id, nis: student.nis, name: student.name, className: student.className } } } },
};

const serializedLoan = { ...loan, loanDate: loanDate.toISOString(), dueDate: dueDate.toISOString(), returnedAt: null, items: loan.items.map((item) => ({ ...item, returnedAt: null })) };
const serializedStudentLoan = { ...studentLoan, loanDate: loanDate.toISOString(), dueDate: dueDate.toISOString(), returnedAt: null, items: studentLoan.items.map((item) => ({ ...item, returnedAt: null })) };
const serializedPayment = { ...payment, amount: "5000.00", paidAt: paymentDate.toISOString() };

async function jsonError(response: Response, status: number, message: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ error: message });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: librarian });
  mocks.bookCount.mockResolvedValue(0);
  mocks.copyCount.mockResolvedValue(0);
  mocks.studentCount.mockResolvedValue(0);
  mocks.loanCount.mockResolvedValue(0);
  mocks.loanFindMany.mockResolvedValue([]);
  mocks.fineAggregate.mockResolvedValue({ _sum: { amount: null } });
  mocks.fineCount.mockResolvedValue(0);
  mocks.paymentFindMany.mockResolvedValue([]);
  mocks.studentFindFirst.mockResolvedValue(student);
  mocks.fineFindMany.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (operations: readonly unknown[]) => Promise.all(operations));
});

afterEach(() => vi.useRealTimers());

describe("GET /api/dashboard", () => {
  it.each([401, 403])("returns authorization error %s", async (status) => {
    mocks.auth.mockResolvedValue({ ok: false, status });
    await jsonError(await route.GET(), status, "Tidak memiliki akses.");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns serialized librarian dashboard and verifies queries", async () => {
    mocks.auth.mockResolvedValue({ ok: true, user: librarian });
    mocks.bookCount.mockResolvedValueOnce(10).mockResolvedValueOnce(15);
    mocks.copyCount.mockResolvedValueOnce(20).mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    mocks.studentCount.mockResolvedValueOnce(8).mockResolvedValueOnce(2);
    mocks.loanCount.mockResolvedValueOnce(6).mockResolvedValueOnce(2);
    mocks.fineAggregate.mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal("15000") } }).mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal("25000") } });
    mocks.fineCount.mockResolvedValueOnce(3).mockResolvedValueOnce(5);
    mocks.loanFindMany.mockResolvedValue([loan]);
    mocks.paymentFindMany.mockResolvedValue([payment]);

    const response = await route.GET();
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({ role: "PUSTAKAWAN", generatedAt: now.toISOString(), data: { books: { active: 10, total: 15 }, copies: { available: 20, borrowed: 3, damaged: 1, lost: 2 }, members: { active: 8, inactive: 2 }, loans: { active: 6, overdue: 2 }, fines: { unpaidCount: 3, unpaidAmount: "15000.00", paidCount: 5, paidAmount: "25000.00" }, recentLoans: [serializedLoan], recentPayments: [serializedPayment] } });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.copyCount).toHaveBeenNthCalledWith(3, expect.objectContaining({ where: expect.objectContaining({ status: "RUSAK" }) }));
    expect(mocks.copyCount).toHaveBeenNthCalledWith(4, expect.objectContaining({ where: expect.objectContaining({ status: "HILANG" }) }));
    expect(mocks.studentCount).toHaveBeenNthCalledWith(1, { where: { isActive: true, user: { status: "AKTIF" } } });
    expect(mocks.studentCount).toHaveBeenNthCalledWith(2, { where: { OR: [{ isActive: false }, { user: { status: "NONAKTIF" } }] } });
    expect(mocks.loanCount).toHaveBeenNthCalledWith(2, { where: { status: { in: ["AKTIF", "SEBAGIAN_DIKEMBALIKAN"] }, dueDate: { lt: now } } });
  });

  it("formats empty librarian fine totals", async () => {
    const response = await route.GET();
    const body = await response.json();
    expect(body.data.fines).toEqual({ unpaidCount: 0, unpaidAmount: "0.00", paidCount: 0, paidAmount: "0.00" });
  });

  it("returns serialized student dashboard", async () => {
    mocks.auth.mockResolvedValue({ ok: true, user: studentUser });
    mocks.loanCount.mockResolvedValueOnce(4).mockResolvedValueOnce(1);
    mocks.fineCount.mockResolvedValue(2);
    mocks.fineAggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal("7500") } });
    mocks.loanFindMany.mockResolvedValueOnce([studentLoan]).mockResolvedValueOnce([studentLoan]);
    mocks.fineFindMany.mockResolvedValue([fine]);

    const response = await route.GET();
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({ role: "SISWA", generatedAt: now.toISOString(), data: { student, loans: { active: 4, overdue: 1 }, fines: { unpaidCount: 2, unpaidAmount: "7500.00" }, activeLoans: [{ id: studentLoan.id, daysLate: 5 }], recentLoans: [serializedStudentLoan], unpaidFines: [{ id: fine.id, ratePerDay: "1000.00", amount: "5000.00", payment: { amount: "0.00" } }] } });
    expect(mocks.studentFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: studentUser.id, isActive: true, user: { status: "AKTIF" } } }));
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when student data is missing", async () => {
    mocks.auth.mockResolvedValue({ ok: true, user: studentUser });
    mocks.studentFindFirst.mockResolvedValue(null);
    await jsonError(await route.GET(), 404, "Data siswa tidak ditemukan.");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns 500 when dashboard query fails", async () => {
    mocks.transaction.mockRejectedValue(new Error("database unavailable"));
    await jsonError(await route.GET(), 500, "Terjadi kesalahan pada server.");
  });
});
