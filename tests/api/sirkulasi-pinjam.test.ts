import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireLibrarian: vi.fn(),
  findUniqueSetting: vi.fn(),
  findStudent: vi.fn(),
  countLoanItems: vi.fn(),
  findCopies: vi.fn(),
  updateCopies: vi.fn(),
  createLoan: vi.fn(),
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

const { POST } = await import("@/app/api/sirkulasi/pinjam/route");

const librarian = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "PUSTAKAWAN" as const,
  status: "AKTIF" as const,
};
const studentId = "22222222-2222-4222-8222-222222222222";
const copyId = "33333333-3333-4333-8333-333333333333";
const loanId = "44444444-4444-4444-8444-444444444444";
const loanItemId = "55555555-5555-4555-8555-555555555555";
const settings = { maxLoanDays: 14, maxActiveCopies: 3 };
const fixedNow = new Date("2026-09-30T08:00:00.000Z");

const createdLoan = {
  id: loanId,
  studentId,
  processedById: librarian.id,
  loanDate: fixedNow,
  dueDate: new Date("2026-10-07T08:00:00.000Z"),
  returnedAt: null,
  status: "AKTIF",
  notes: "Untuk belajar",
  items: [{ id: loanItemId, copyId }],
};

function futureDueDate(days = 7) {
  return new Date(fixedNow.getTime() + days * 86_400_000).toISOString();
}

function requestWithBody(body: unknown) {
  return new Request("http://localhost/api/sirkulasi/pinjam", {
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
    librarySetting: { findUnique: mocks.findUniqueSetting },
    student: { findFirst: mocks.findStudent },
    loanItem: { count: mocks.countLoanItems },
    bookCopy: {
      findMany: mocks.findCopies,
      updateMany: mocks.updateCopies,
    },
    loan: { create: mocks.createLoan },
    auditLog: { create: mocks.createAuditLog },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(fixedNow);
  vi.resetAllMocks();

  mocks.requireLibrarian.mockResolvedValue({ ok: true, user: librarian });
  mocks.findUniqueSetting.mockResolvedValue(settings);
  mocks.findStudent.mockResolvedValue({ id: studentId });
  mocks.countLoanItems.mockResolvedValue(0);
  mocks.findCopies.mockResolvedValue([{ id: copyId }]);
  mocks.updateCopies.mockResolvedValue({ count: 1 });
  mocks.createLoan.mockResolvedValue(createdLoan);
  mocks.createAuditLog.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (callback: Function) =>
    callback(transactionClient()),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/sirkulasi/pinjam", () => {
  it.each([401, 403])("returns %s when user lacks librarian access", async (status) => {
    mocks.requireLibrarian.mockResolvedValue({ ok: false, status });

    await expectJsonError(
      await POST(requestWithBody({ studentId, copyIds: [copyId], dueDate: futureDueDate() })),
      status,
      "Tidak memiliki akses.",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const request = new Request("http://localhost/api/sirkulasi/pinjam", {
      method: "POST",
      body: "{invalid-json",
    });

    await expectJsonError(await POST(request), 400, "Body JSON tidak valid.");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    "invalid-body",
    123,
    { studentId, copyIds: [copyId], dueDate: futureDueDate(), unexpected: true },
    { studentId: "invalid-id", copyIds: [copyId], dueDate: futureDueDate() },
    { studentId, copyIds: [], dueDate: futureDueDate() },
    { studentId, copyIds: [copyId, copyId], dueDate: futureDueDate() },
    { studentId, copyIds: [copyId], dueDate: new Date(fixedNow.getTime() - 1).toISOString() },
  ])("returns 422 for invalid request: %j", async (body) => {
    const structural = body === null || Array.isArray(body) || typeof body !== "object" ||
      (body !== null && typeof body === "object" && "unexpected" in body);
    await expectJsonError(
      await POST(requestWithBody(body)),
      422,
      structural ? "Body request tidak valid." : "Data peminjaman tidak valid.",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a due date beyond configured maximum", async () => {
    await expectJsonError(
      await POST(requestWithBody({ studentId, copyIds: [copyId], dueDate: futureDueDate(15) })),
      422,
      "Tanggal jatuh tempo melebihi batas pengaturan.",
    );
    expect(mocks.findStudent).not.toHaveBeenCalled();
  });

  it("rejects requested copies beyond configured maximum", async () => {
    mocks.findUniqueSetting.mockResolvedValue({ ...settings, maxActiveCopies: 1 });

    await expectJsonError(
      await POST(requestWithBody({
        studentId,
        copyIds: [copyId, "66666666-6666-4666-8666-666666666666"],
        dueDate: futureDueDate(),
      })),
      422,
      "Jumlah buku melebihi batas anggota.",
    );
    expect(mocks.findStudent).not.toHaveBeenCalled();
  });

  it("rejects when existing and requested copies exceed maximum", async () => {
    mocks.countLoanItems.mockResolvedValue(2);

    await expectJsonError(
      await POST(requestWithBody({ studentId, copyIds: [copyId, "66666666-6666-4666-8666-666666666666"], dueDate: futureDueDate() })),
      422,
      "Jumlah buku melebihi batas anggota.",
    );
    expect(mocks.findCopies).not.toHaveBeenCalled();
  });

  it("rejects missing or inactive student", async () => {
    mocks.findStudent.mockResolvedValue(null);

    await expectJsonError(
      await POST(requestWithBody({ studentId, copyIds: [copyId], dueDate: futureDueDate() })),
      422,
      "Anggota tidak ditemukan atau tidak aktif.",
    );

    expect(mocks.findStudent).toHaveBeenCalledWith({
      where: { id: studentId, isActive: true, user: { status: "AKTIF" } },
      select: { id: true },
    });
  });

  it("rejects when student active limit is reached", async () => {
    mocks.countLoanItems.mockResolvedValue(settings.maxActiveCopies);

    await expectJsonError(
      await POST(requestWithBody({ studentId, copyIds: [copyId], dueDate: futureDueDate() })),
      422,
      "Jumlah buku melebihi batas anggota.",
    );
    expect(mocks.findCopies).not.toHaveBeenCalled();
  });

  it("rejects unavailable copies", async () => {
    mocks.findCopies.mockResolvedValue([]);

    await expectJsonError(
      await POST(requestWithBody({ studentId, copyIds: [copyId], dueDate: futureDueDate() })),
      409,
      "Salah satu salinan tidak tersedia.",
    );
    expect(mocks.updateCopies).not.toHaveBeenCalled();
  });

  it("uses active book and category filters when finding copies", async () => {
    await POST(requestWithBody({ studentId, copyIds: [copyId], dueDate: futureDueDate() }));

    expect(mocks.findCopies).toHaveBeenCalledWith({
      where: {
        id: { in: [copyId] },
        isActive: true,
        status: "TERSEDIA",
        book: { isActive: true, category: { is: { isActive: true } } },
      },
      select: { id: true },
    });
  });

  it("rejects an incomplete copy lock", async () => {
    mocks.updateCopies.mockResolvedValue({ count: 0 });

    await expectJsonError(
      await POST(requestWithBody({ studentId, copyIds: [copyId], dueDate: futureDueDate() })),
      409,
      "Salinan baru saja dipinjam pengguna lain.",
    );
    expect(mocks.createLoan).not.toHaveBeenCalled();
  });

  it("returns 500 when settings are missing", async () => {
    mocks.findUniqueSetting.mockResolvedValue(null);

    await expectJsonError(
      await POST(requestWithBody({ studentId, copyIds: [copyId], dueDate: futureDueDate() })),
      500,
      "Pengaturan perpustakaan belum tersedia.",
    );
  });

  it("retries P2034 three times then returns 409", async () => {
    let attempts = 0;
    const calls: unknown[][] = [];
    mocks.transaction.mockImplementation(async (...args: unknown[]) => {
      calls.push(args);
      attempts += 1;
      throw Object.assign(new Error("serialization conflict"), { code: "P2034" });
    });

    await expectJsonError(
      await POST(requestWithBody({ studentId, copyIds: [copyId], dueDate: futureDueDate() })),
      409,
      "Permintaan konflik, coba lagi.",
    );
    expect(attempts).toBe(3);
    expect(calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });

  it("returns 201 and records loan, copy lock, and audit log", async () => {
    const response = await POST(
      requestWithBody({
        studentId,
        copyIds: [copyId],
        dueDate: futureDueDate(),
        notes: "  Untuk belajar  ",
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.json()).data).toMatchObject({
      id: loanId,
      studentId,
      processedById: librarian.id,
      status: "AKTIF",
      notes: "Untuk belajar",
    });
    expect(mocks.updateCopies).toHaveBeenCalledWith({
      where: { id: { in: [copyId] }, isActive: true, status: "TERSEDIA" },
      data: { status: "DIPINJAM" },
    });
    expect(mocks.createLoan).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        studentId,
        processedById: librarian.id,
        status: "AKTIF",
        notes: "Untuk belajar",
        items: { create: [{ copyId }] },
      }),
    }));
    expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: librarian.id,
        action: "CREATE",
        entityType: "Loan",
        entityId: loanId,
      }),
    }));
  });
});
