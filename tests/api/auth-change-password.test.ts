import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = {
  auth: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  verify: vi.fn(),
  hash: vi.fn(),
  createToken: vi.fn(),
};

vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE_NAME: "simpli_auth",
  authCookieOptions: {},
  createAuthToken: mocks.createToken,
  noStoreHeaders: { "Cache-Control": "no-store" },
  requireSchoolContext: mocks.auth,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("argon2", () => ({ default: { verify: mocks.verify, hash: mocks.hash } }));

const { POST } = await import("@/app/api/auth/change-password/route");

function request(body: unknown) {
  return new Request("http://localhost/api/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, schoolId: "school-1", user: { id: "user-1" } });
  mocks.findUnique.mockResolvedValue({ passwordHash: "old-hash" });
  mocks.verify.mockResolvedValue(true);
  mocks.hash.mockResolvedValue("new-hash");
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    user: { update: mocks.update },
    auditLog: { create: mocks.auditCreate },
  }));
  mocks.update.mockResolvedValue({ id: "user-1", schoolId: "school-1", role: "PUSTAKAWAN" });
  mocks.createToken.mockResolvedValue("rotated-token");
});

describe("POST /api/auth/change-password", () => {
  it("changes password and rotates auth cookie", async () => {
    const response = await POST(request({ currentPassword: "old-password", newPassword: "new-password-123" }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { passwordHash: "new-hash", mustChangePassword: false } }));
    expect(response.headers.get("set-cookie")).toContain("simpli_auth=rotated-token");
  });

  it("rejects wrong current password", async () => {
    mocks.verify.mockResolvedValue(false);
    const response = await POST(request({ currentPassword: "wrong", newPassword: "new-password-123" }));
    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
