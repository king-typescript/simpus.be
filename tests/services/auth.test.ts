import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, type JWTPayload } from "jose";
import { cookies } from "next/headers";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

const TEST_AUTH_SECRET = "01234567890123456789012345678901";
process.env.AUTH_SECRET = TEST_AUTH_SECRET;

const { prisma } = await import("@/lib/prisma");
const {
  AUTH_COOKIE_NAME,
  authCookieOptions,
  clearAuthCookieOptions,
  createAuthToken,
  noStoreHeaders,
  requireAuthenticatedUser,
  requireLibrarian,
  verifyAuthToken,
} = await import("@/lib/auth");

const cookiesMock = vi.mocked(cookies);
const findUniqueMock = vi.mocked(prisma.user.findUnique);

type AuthenticatedUser = {
  id: string;
  username: string;
  name: string | null;
  role: "PUSTAKAWAN" | "SISWA";
  status: "AKTIF" | "NONAKTIF";
};

type LibrarianUser = Pick<AuthenticatedUser, "id" | "role" | "status">;

type UserLookupResult = AuthenticatedUser | LibrarianUser | null;

type UserLookupCases = {
  user: UserLookupResult;
  label: string;
};

function mockUserLookup(user: UserLookupResult) {
  findUniqueMock.mockResolvedValue(
    user as Awaited<ReturnType<typeof prisma.user.findUnique>>,
  );
}

const validUser = {
  id: "user-1",
  username: "librarian",
  name: "Librarian",
  role: "PUSTAKAWAN" as const,
  status: "AKTIF" as const,
};

function mockAuthCookie(token?: string) {
  cookiesMock.mockResolvedValue({
    get: vi.fn((name: string) =>
      name === AUTH_COOKIE_NAME && token ? { value: token } : undefined,
    ),
  } as never);
}

async function createTestToken(
  payload: JWTPayload,
  options: {
    expiration?: string;
    issuer?: string;
    audience?: string;
    secret?: string;
  } = {},
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(options.issuer ?? "simpus-satak")
    .setAudience(options.audience ?? "simpus-satak-api")
    .setIssuedAt()
    .setExpirationTime(options.expiration ?? "1h")
    .sign(new TextEncoder().encode(options.secret ?? TEST_AUTH_SECRET));
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.AUTH_SECRET = TEST_AUTH_SECRET;
  mockAuthCookie();
});

describe("createAuthToken and verifyAuthToken", () => {
  it("creates and verifies a valid token", async () => {
    const token = await createAuthToken({
      userId: "user-1",
      role: "PUSTAKAWAN",
    });

    const payload = await verifyAuthToken(token);

    expect(payload.userId).toBe("user-1");
    expect(payload.role).toBe("PUSTAKAWAN");
    expect(payload.iss).toBe("simpus-satak");
    expect(payload.aud).toBe("simpus-satak-api");
    expect(payload.exp).toEqual(expect.any(Number));
    expect(payload.iat).toEqual(expect.any(Number));
    expect(payload.jti).toEqual(expect.any(String));
  });

  it("generates unique tokens", async () => {
    const payload = { userId: "user-1", role: "PUSTAKAWAN" as const };

    const first = await createAuthToken(payload);
    const second = await createAuthToken(payload);

    expect(first).not.toBe(second);
  });

  it.each([
    ["malformed token", "not-a-jwt"],
    ["invalid signature", undefined],
  ])("rejects %s", async (_name, token) => {
    const invalidToken =
      token ??
      (await createTestToken(
        { userId: "user-1", role: "PUSTAKAWAN" },
        { secret: "different-secret-012345678901234567890" },
      ));

    await expect(verifyAuthToken(invalidToken)).rejects.toThrow();
  });

  it("rejects expired token", async () => {
    const token = await createTestToken(
      { userId: "user-1", role: "PUSTAKAWAN" },
      { expiration: "0s" },
    );

    await expect(verifyAuthToken(token)).rejects.toThrow();
  });

  it("rejects token with invalid issuer", async () => {
    const token = await createTestToken(
      { userId: "user-1", role: "PUSTAKAWAN" },
      { issuer: "wrong-issuer" },
    );

    await expect(verifyAuthToken(token)).rejects.toThrow();
  });

  it("rejects token with invalid audience", async () => {
    const token = await createTestToken(
      { userId: "user-1", role: "PUSTAKAWAN" },
      { audience: "wrong-audience" },
    );

    await expect(verifyAuthToken(token)).rejects.toThrow();
  });

  it.each([
    [{ userId: "user-1", role: "ADMIN" }, "Token auth tidak valid."],
    [{ userId: "", role: "PUSTAKAWAN" }, "Token auth tidak valid."],
    [{ role: "PUSTAKAWAN" }, "Token auth tidak valid."],
    [{ userId: "user-1" }, "Token auth tidak valid."],
  ])("rejects invalid payload %j", async (payload, message) => {
    const token = await createTestToken(payload);

    await expect(verifyAuthToken(token)).rejects.toThrow(message);
  });

  it("rejects token creation when AUTH_SECRET is missing", async () => {
    process.env.AUTH_SECRET = "";

    await expect(
      createAuthToken({ userId: "user-1", role: "PUSTAKAWAN" }),
    ).rejects.toThrow("AUTH_SECRET harus diatur dan minimal 32 byte.");
  });

  it("rejects token creation when AUTH_SECRET is too short", async () => {
    process.env.AUTH_SECRET = "short-secret";

    await expect(
      createAuthToken({ userId: "user-1", role: "PUSTAKAWAN" }),
    ).rejects.toThrow("AUTH_SECRET harus diatur dan minimal 32 byte.");
  });
});

describe("requireAuthenticatedUser", () => {
  it("returns 401 when auth cookie is missing", async () => {
    mockAuthCookie();

    await expect(requireAuthenticatedUser()).resolves.toEqual({
      ok: false,
      status: 401,
    });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns authenticated active user", async () => {
    const token = await createAuthToken({
      userId: validUser.id,
      role: validUser.role,
    });

    mockAuthCookie(token);
    mockUserLookup(validUser);

    await expect(requireAuthenticatedUser()).resolves.toEqual({
      ok: true,
      user: validUser,
    });
  });

  it.each<UserLookupCases>([
    { user: null, label: "missing user" },
    {
      user: { ...validUser, status: "NONAKTIF" },
      label: "inactive user",
    },
  ])("returns 401 for unavailable user ($label)", async ({ user }) => {
    const token = await createAuthToken({
      userId: validUser.id,
      role: validUser.role,
    });

    mockAuthCookie(token);
    mockUserLookup(user);

    await expect(requireAuthenticatedUser()).resolves.toEqual({
      ok: false,
      status: 401,
    });
  });

  it("returns 401 when token is invalid", async () => {
    mockAuthCookie("invalid-token");

    await expect(requireAuthenticatedUser()).resolves.toEqual({
      ok: false,
      status: 401,
    });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 401 when Prisma lookup fails", async () => {
    const token = await createAuthToken({
      userId: validUser.id,
      role: validUser.role,
    });

    mockAuthCookie(token);
    findUniqueMock.mockRejectedValue(new Error("database unavailable"));

    await expect(requireAuthenticatedUser()).resolves.toEqual({
      ok: false,
      status: 401,
    });
  });
});

describe("requireLibrarian", () => {
  it("returns 401 when auth cookie is missing", async () => {
    mockAuthCookie();

    await expect(requireLibrarian()).resolves.toEqual({
      ok: false,
      status: 401,
    });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns active librarian", async () => {
    const token = await createAuthToken({
      userId: validUser.id,
      role: validUser.role,
    });

    mockAuthCookie(token);
    mockUserLookup({
      id: validUser.id,
      role: "PUSTAKAWAN",
      status: "AKTIF",
    });

    await expect(requireLibrarian()).resolves.toEqual({
      ok: true,
      user: { id: validUser.id, role: "PUSTAKAWAN", status: "AKTIF" },
    });
  });

  it("returns 403 for active non-librarian user", async () => {
    const token = await createAuthToken({
      userId: "student-1",
      role: "SISWA",
    });

    mockAuthCookie(token);
    mockUserLookup({
      id: "student-1",
      role: "SISWA",
      status: "AKTIF",
    });

    await expect(requireLibrarian()).resolves.toEqual({
      ok: false,
      status: 403,
    });
  });

  it.each<
    UserLookupCases & { status: 401 }
  >([
    { user: null, label: "missing user", status: 401 },
    {
      user: { id: validUser.id, role: "PUSTAKAWAN", status: "NONAKTIF" },
      label: "inactive user",
      status: 401,
    },
  ])("returns $status for unavailable librarian ($label)", async ({ user, status }) => {
    const token = await createAuthToken({
      userId: validUser.id,
      role: validUser.role,
    });

    mockAuthCookie(token);
    mockUserLookup(user);

    await expect(requireLibrarian()).resolves.toEqual({
      ok: false,
      status,
    });
  });

  it("returns 401 when Prisma lookup fails", async () => {
    const token = await createAuthToken({
      userId: validUser.id,
      role: validUser.role,
    });

    mockAuthCookie(token);
    findUniqueMock.mockRejectedValue(new Error("database unavailable"));

    await expect(requireLibrarian()).resolves.toEqual({
      ok: false,
      status: 401,
    });
  });
});

describe("auth constants", () => {
  it("defines secure auth cookie options", () => {
    expect(authCookieOptions).toEqual({
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 86_400,
    });
  });

  it("defines cookie clearing options", () => {
    expect(clearAuthCookieOptions).toEqual({
      ...authCookieOptions,
      maxAge: 0,
    });
  });

  it("defines no-store cache headers", () => {
    expect(noStoreHeaders).toEqual({
      "Cache-Control": "no-store",
    });
  });
});
