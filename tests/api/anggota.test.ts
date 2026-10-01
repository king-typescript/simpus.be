import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireLibrarian: vi.fn(),
  hash: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  userCreate: vi.fn(),
  studentCreate: vi.fn(),
  auditLogCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("argon2", () => ({
  default: { hash: mocks.hash },
}));

vi.mock("@/lib/auth", () => ({
  noStoreHeaders: { "Cache-Control": "no-store" },
  requireLibrarian: mocks.requireLibrarian,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: {
      findMany: mocks.findMany,
      count: mocks.count,
    },
    $transaction: mocks.transaction,
  },
}));

const { GET, POST } = await import("@/app/api/anggota/route");

const librarian = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "PUSTAKAWAN" as const,
  status: "AKTIF" as const,
};

const studentId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const timestamp = new Date("2026-09-30T08:00:00.000Z");

const student = {
  id: studentId,
  nis: "2026001",
  name: "Budi Santoso",
  className: "VII-A",
  libraryCardNumber: "KARTU-001",
  phone: "081234567890",
  isActive: true,
  joinedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  user: {
    id: userId,
    username: "budi",
    status: "AKTIF",
  },
};

const serializedStudent = {
  ...student,
  joinedAt: timestamp.toISOString(),
  createdAt: timestamp.toISOString(),
  updatedAt: timestamp.toISOString(),
};

function request(
  method: "GET" | "POST",
  url = "http://localhost/api/anggota",
  body?: unknown,
) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function validMember(overrides: Record<string, unknown> = {}) {
  return {
    username: "budi",
    password: "password-valid",
    nis: "2026001",
    name: "Budi Santoso",
    className: "VII-A",
    libraryCardNumber: "KARTU-001",
    phone: null,
    ...overrides,
  };
}

async function expectJsonError(
  response: Response,
  status: number,
  error: string,
) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ error });
}

function transactionClient() {
  return {
    user: { create: mocks.userCreate },
    student: { create: mocks.studentCreate },
    auditLog: { create: mocks.auditLogCreate },
  };
}

type TransactionClient = ReturnType<typeof transactionClient>;
type TransactionCallback = (
  tx: TransactionClient,
) => unknown | Promise<unknown>;

beforeEach(() => {
  vi.resetAllMocks();

  mocks.requireLibrarian.mockResolvedValue({ ok: true, user: librarian });
  mocks.findMany.mockResolvedValue([student]);
  mocks.count.mockResolvedValue(1);
  mocks.hash.mockResolvedValue("argon2-password-hash");
  mocks.userCreate.mockResolvedValue({
    id: userId,
    username: "budi",
    passwordHash: "argon2-password-hash",
    role: "SISWA",
    status: "AKTIF",
    name: "Budi Santoso",
  });
  mocks.studentCreate.mockResolvedValue(student);
  mocks.auditLogCreate.mockResolvedValue({});
  mocks.transaction.mockImplementation(
    async (operation: TransactionCallback | readonly unknown[]) => {
      if (typeof operation === "function") {
        return operation(transactionClient());
      }

      return Promise.all(operation);
    },
  );
});

describe("GET /api/anggota", () => {
  it.each([401, 403])(
    "returns %s when user lacks librarian access",
    async (status) => {
      mocks.requireLibrarian.mockResolvedValue({ ok: false, status });

      await expectJsonError(
        await GET(request("GET")),
        status,
        "Tidak memiliki akses.",
      );

      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it("returns students with default pagination", async () => {
    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: [serializedStudent],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {},
      select: {
        id: true,
        nis: true,
        name: true,
        className: true,
        libraryCardNumber: true,
        phone: true,
        isActive: true,
        joinedAt: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, username: true, status: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 0,
      take: 20,
    });
    expect(mocks.count).toHaveBeenCalledWith({ where: {} });
  });

  it("applies pagination filters", async () => {
    await GET(request("GET", "http://localhost/api/anggota?page=3&limit=25"));

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50, take: 25 }),
    );
  });

  it.each(["0", "-1", "1.5", "NaN", "invalid"])(
    "rejects invalid pagination %s",
    async (value) => {
      await expectJsonError(
        await GET(request("GET", `http://localhost/api/anggota?page=${value}&limit=${value}`)),
        422,
        "Parameter page tidak valid.",
      );
    },
  );

  it("rejects oversized limit", async () => {
    await expectJsonError(
      await GET(request("GET", "http://localhost/api/anggota?page=2&limit=999")),
      422,
      "Parameter limit tidak valid.",
    );
  });

  it("applies search, class, and active status filters", async () => {
    await GET(
      request(
        "GET",
        "http://localhost/api/anggota?search=%20Budi%20&className=%20VII-A%20&status=AKTIF",
      ),
    );

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          className: { contains: "VII-A", mode: "insensitive" },
          OR: [
            { name: { contains: "Budi", mode: "insensitive" } },
            { nis: { contains: "Budi", mode: "insensitive" } },
            {
              libraryCardNumber: {
                contains: "Budi",
                mode: "insensitive",
              },
            },
            {
              user: {
                username: { contains: "Budi", mode: "insensitive" },
              },
            },
          ],
        },
      }),
    );
  });

  it("applies inactive status filter", async () => {
    await GET(request("GET", "http://localhost/api/anggota?status=NONAKTIF"));

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: false } }),
    );
  });

  it("returns 422 for invalid status", async () => {
    await expectJsonError(
      await GET(request("GET", "http://localhost/api/anggota?status=INVALID")),
      422,
      "Status tidak valid.",
    );

    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("returns 500 when findMany fails", async () => {
    mocks.findMany.mockRejectedValue(new Error("database unavailable"));

    await expectJsonError(
      await GET(request("GET")),
      500,
      "Terjadi kesalahan pada server.",
    );
  });

  it("returns 500 when count fails", async () => {
    mocks.count.mockRejectedValue(new Error("database unavailable"));

    await expectJsonError(
      await GET(request("GET")),
      500,
      "Terjadi kesalahan pada server.",
    );
  });
});

describe("POST /api/anggota", () => {
  it.each([401, 403])(
    "returns %s when user lacks librarian access",
    async (status) => {
      mocks.requireLibrarian.mockResolvedValue({ ok: false, status });

      await expectJsonError(
        await POST(request("POST", undefined, validMember())),
        status,
        "Tidak memiliki akses.",
      );

      expect(mocks.hash).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for malformed JSON", async () => {
    const malformedRequest = new Request("http://localhost/api/anggota", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid-json",
    });

    await expectJsonError(
      await POST(malformedRequest),
      400,
      "Body JSON tidak valid.",
    );
  });

  it.each([null, [], "invalid-body", 123])(
    "returns 422 for non-object body: %j",
    async (body) => {
      await expectJsonError(
        await POST(request("POST", undefined, body)),
        422,
        "Body request tidak valid.",
      );

      expect(mocks.hash).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    validMember({ username: "" }),
    validMember({ password: "short" }),
    validMember({ nis: "" }),
    validMember({ name: "" }),
    validMember({ className: "" }),
    validMember({ libraryCardNumber: "" }),
    validMember({ phone: 123 }),
    validMember({ username: "x".repeat(101) }),
    validMember({ nis: "x".repeat(51) }),
    validMember({ name: "x".repeat(151) }),
    validMember({ className: "x".repeat(101) }),
    validMember({ libraryCardNumber: "x".repeat(101) }),
  ])("returns 422 for invalid member data", async (body) => {
    await expectJsonError(
      await POST(request("POST", undefined, body)),
      422,
      "Data anggota tidak valid.",
    );

    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("trims fields and uses exact persistence select", async () => {
    await POST(
      request(
        "POST",
        undefined,
        validMember({
          username: "  budi  ",
          nis: " 2026001 ",
          name: " Budi Santoso ",
          className: " VII-A ",
          libraryCardNumber: " KARTU-001 ",
          phone: " 081234567890 ",
        }),
      ),
    );

    expect(mocks.hash).toHaveBeenCalledWith("password-valid");
    expect(mocks.userCreate).toHaveBeenCalledWith({
      data: {
        username: "budi",
        passwordHash: "argon2-password-hash",
        role: "SISWA",
        status: "AKTIF",
        name: "Budi Santoso",
      },
    });
    expect(mocks.studentCreate).toHaveBeenCalledWith({
      data: {
        userId,
        nis: "2026001",
        name: "Budi Santoso",
        className: "VII-A",
        libraryCardNumber: "KARTU-001",
        phone: "081234567890",
      },
      select: {
        id: true,
        nis: true,
        name: true,
        className: true,
        libraryCardNumber: true,
        phone: true,
        isActive: true,
        joinedAt: true,
        user: {
          select: { id: true, username: true, status: true },
        },
      },
    });
  });

  it("accepts null phone", async () => {
    const response = await POST(
      request("POST", undefined, validMember({ phone: null })),
    );

    expect(response.status).toBe(201);
    expect(mocks.studentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: null }),
      }),
    );
  });

  it("returns 201 and writes audit log without password fields", async () => {
    const response = await POST(
      request("POST", undefined, validMember({ phone: "081234567890" })),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const body = await response.json();
    expect(body.data).toEqual(serializedStudent);
    expect(body.data).not.toHaveProperty("passwordHash");
    expect(body.data).not.toHaveProperty("password");

    expect(mocks.auditLogCreate).toHaveBeenCalledWith({
      data: {
        userId: librarian.id,
        action: "CREATE",
        entityType: "Student",
        entityId: studentId,
        newData: student,
        ipAddress: null,
      },
    });
  });

  it("returns 409 for unique constraint violation", async () => {
    mocks.transaction.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      }),
    );

    await expectJsonError(
      await POST(request("POST", undefined, validMember())),
      409,
      "Username, NIS, atau nomor kartu sudah digunakan.",
    );
  });

  it("returns 500 when password hashing fails", async () => {
    mocks.hash.mockRejectedValue(new Error("argon2 failure"));

    await expectJsonError(
      await POST(request("POST", undefined, validMember())),
      500,
      "Terjadi kesalahan pada server.",
    );

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns 500 when transaction fails", async () => {
    mocks.transaction.mockRejectedValue(new Error("database unavailable"));

    await expectJsonError(
      await POST(request("POST", undefined, validMember())),
      500,
      "Terjadi kesalahan pada server.",
    );
  });

  it("creates user, student, and audit log in one transaction", async () => {
    const response = await POST(
      request("POST", undefined, validMember()),
    );

    expect(response.status).toBe(201);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.userCreate).toHaveBeenCalledTimes(1);
    expect(mocks.studentCreate).toHaveBeenCalledTimes(1);
    expect(mocks.auditLogCreate).toHaveBeenCalledTimes(1);
  });
});
