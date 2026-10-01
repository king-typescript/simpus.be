import { describe, expect, it, vi } from "vitest";

const AUTH_COOKIE_NAME = "simpli_auth";

vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE_NAME,
  clearAuthCookieOptions: {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  },
  noStoreHeaders: { "Cache-Control": "no-store" },
  requireAuthenticatedUser: vi.fn().mockResolvedValue({ ok: false }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { auditLog: { create: vi.fn() } },
}));

const { POST } = await import("@/app/api/auth/logout/route");

function mockRequest() {
  return new Request("http://localhost/api/auth/logout", { method: "POST" });
}

describe("POST /api/auth/logout", () => {
  it("returns successful logout response", async () => {
    const response = await POST(mockRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ message: "Logout berhasil." });
  });

  it("clears authentication cookie", async () => {
    const cookie = (await POST(mockRequest())).headers.get("set-cookie");

    expect(cookie).toContain(`${AUTH_COOKIE_NAME}=`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/");
  });
});
