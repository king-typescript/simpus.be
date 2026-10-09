import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  schoolFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  update: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  createAuthToken: vi.fn(),
  countFailed: vi.fn(),
}));

vi.mock("argon2", () => ({
  default: { verify: mocks.verify },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: mocks.schoolFindUnique },
    user: { findUnique: mocks.userFindUnique, update: mocks.update },
    auditLog: { create: mocks.auditCreate, count: mocks.countFailed },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: async (keys: (string | null)[]) => {
    if (!keys.length) return false;
    const count = await mocks.countFailed();
    return count >= 5;
  },
  recordAccountFailure: async () => {},
}));

vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE_NAME: "simpli_auth",
  authCookieOptions: {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 86_400,
  },
  createAuthToken: mocks.createAuthToken,
  noStoreHeaders: { "Cache-Control": "no-store" },
}));

const { POST } = await import("@/app/api/auth/login/route");

const school = {
  id: "school-1",
  code: "SCH",
  name: "SMA Negeri 1",
  isActive: true,
};

const activeUser = {
  id: "user-1",
  schoolId: "school-1",
  username: "librarian",
  passwordHash: "hashed-password",
  name: "Librarian",
  role: "PUSTAKAWAN",
  status: "AKTIF",
  mustChangePassword: false,
};

function requestWithBody(body: unknown) {
  return new Request("http://localhost/api/auth/login", {
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

beforeEach(() => {
  vi.resetAllMocks();
  mocks.countFailed.mockResolvedValue(0);
  mocks.createAuthToken.mockResolvedValue("signed-auth-token");
  mocks.schoolFindUnique.mockResolvedValue(school);
  mocks.userFindUnique.mockResolvedValue(activeUser);
  mocks.verify.mockResolvedValue(true);
  mocks.update.mockResolvedValue({});
  mocks.auditCreate.mockResolvedValue({});
  mocks.transaction.mockImplementation((operations: unknown[]) => Promise.all(operations));
});

describe("POST /api/auth/login", () => {
  it("returns 400 for malformed JSON", async () => {
    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid-json",
    });

    await expectJsonError(
      await POST(request),
      400,
      "Body JSON tidak valid.",
    );
    expect(mocks.schoolFindUnique).not.toHaveBeenCalled();
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it.each([null, [], "invalid-body", 123])(
    "returns 400 for invalid body: %j",
    async (body) => {
      await expectJsonError(
        await POST(requestWithBody(body)),
        400,
        "Body request tidak valid.",
      );
    },
  );

  it.each([
    { schoolCode: "", username: "librarian", password: "valid-password" },
    { schoolCode: "SCH", username: "", password: "valid-password" },
    { schoolCode: "SCH", username: "librarian", password: "" },
    { schoolCode: "   ", username: "librarian", password: "valid-password" },
    { schoolCode: "SCH", username: "librarian" },
    { username: "librarian", password: "valid-password" },
    { schoolCode: "SCH", username: "librarian", password: "x".repeat(257) },
    { schoolCode: "SCH", username: "x".repeat(101), password: "valid-password" },
    { schoolCode: "S".repeat(101), username: "librarian", password: "valid-password" },
  ])("returns 401 for invalid credentials: %j", async (body) => {
    await expectJsonError(
      await POST(requestWithBody(body)),
      401,
      "Username atau password salah.",
    );
    expect(mocks.schoolFindUnique).not.toHaveBeenCalled();
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it("returns 401 when school does not exist and skips user lookup", async () => {
    mocks.schoolFindUnique.mockResolvedValue(null);

    await expectJsonError(
      await POST(requestWithBody({ schoolCode: "UNKNOWN", username: "librarian", password: "wrong-password" })),
      401,
      "Username atau password salah.",
    );
    expect(mocks.verify).toHaveBeenCalledWith(expect.any(String), "wrong-password");
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.createAuthToken).not.toHaveBeenCalled();
  });

  it("returns 401 when school is inactive", async () => {
    mocks.schoolFindUnique.mockResolvedValue({ ...school, isActive: false });

    await expectJsonError(
      await POST(requestWithBody({ schoolCode: "SCH", username: "librarian", password: "correct-password" })),
      401,
      "Username atau password salah.",
    );
    expect(mocks.createAuthToken).not.toHaveBeenCalled();
  });

  it("returns 401 when user does not exist", async () => {
    mocks.userFindUnique.mockResolvedValue(null);

    await expectJsonError(
      await POST(requestWithBody({ schoolCode: "SCH", username: "unknown", password: "wrong-password" })),
      401,
      "Username atau password salah.",
    );
    expect(mocks.verify).toHaveBeenCalledWith(expect.any(String), "wrong-password");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.createAuthToken).not.toHaveBeenCalled();
  });

  it("returns 401 when password is incorrect", async () => {
    mocks.verify.mockResolvedValue(false);

    await expectJsonError(
      await POST(requestWithBody({ schoolCode: "SCH", username: "librarian", password: "wrong-password" })),
      401,
      "Username atau password salah.",
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.createAuthToken).not.toHaveBeenCalled();
  });

  it("returns 401 when user is inactive", async () => {
    mocks.userFindUnique.mockResolvedValue({ ...activeUser, status: "NONAKTIF" });

    await expectJsonError(
      await POST(requestWithBody({ schoolCode: "SCH", username: "librarian", password: "correct-password" })),
      401,
      "Username atau password salah.",
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.createAuthToken).not.toHaveBeenCalled();
  });

  it("looks up school by code and user by trimmed username", async () => {
    const response = await POST(
      requestWithBody({ schoolCode: "  SCH  ", username: "  librarian  ", password: "correct-password" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.schoolFindUnique).toHaveBeenCalledWith({
      where: { code: "SCH" },
      select: { id: true, code: true, name: true, isActive: true },
    });
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { schoolId_username: { schoolId: "school-1", username: "librarian" } },
      select: {
        id: true,
        schoolId: true,
        username: true,
        passwordHash: true,
        name: true,
        role: true,
        status: true,
        mustChangePassword: true,
      },
    });
  });

  it("ignores unknown body fields", async () => {
    const response = await POST(
      requestWithBody({ schoolCode: "SCH", username: "librarian", password: "correct-password", ignored: true }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects a non-JSON content type", async () => {
    const response = await POST(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ schoolCode: "SCH", username: "librarian", password: "correct-password" }),
    }));

    await expectJsonError(response, 415, "Content-Type harus application/json.");
    expect(mocks.schoolFindUnique).not.toHaveBeenCalled();
  });

  it("returns authenticated user, school, and sets auth cookie", async () => {
    const response = await POST(
      requestWithBody({ schoolCode: "SCH", username: "librarian", password: "correct-password" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: "user-1",
        username: "librarian",
        name: "Librarian",
        role: "PUSTAKAWAN",
      },
      school,
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.verify).toHaveBeenCalledWith("hashed-password", "correct-password");
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastLoginAt: expect.any(Date) },
    });
    expect(mocks.createAuthToken).toHaveBeenCalledWith({
      userId: "user-1",
      schoolId: "school-1",
      role: "PUSTAKAWAN",
    });

    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("simpli_auth=signed-auth-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Max-Age=86400");
    expect(cookie).toContain("Path=/");
  });

  it("returns 429 when rate limited", async () => {
    mocks.countFailed.mockResolvedValue(5);

    await expectJsonError(
      await POST(requestWithBody({ schoolCode: "SCH", username: "librarian", password: "correct-password" })),
      429,
      "Terlalu banyak percobaan login. Coba lagi nanti.",
    );
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.schoolFindUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["database lookup", () => mocks.schoolFindUnique.mockRejectedValue(new Error("database unavailable"))],
    ["password verification", () => mocks.verify.mockRejectedValue(new Error("argon2 failure"))],
    ["last login update", () => mocks.update.mockRejectedValue(new Error("database unavailable"))],
    ["token creation", () => mocks.createAuthToken.mockRejectedValue(new Error("token failure"))],
  ])("returns 500 when %s fails", async (_operation, configureFailure) => {
    configureFailure();

    await expectJsonError(
      await POST(requestWithBody({ schoolCode: "SCH", username: "librarian", password: "correct-password" })),
      500,
      "Terjadi kesalahan pada server.",
    );
  });
});
