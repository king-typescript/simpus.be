import { describe, expect, it } from "vitest";

const route = await import("@/app/api/sirkulasi/perpanjang/route");

describe("POST /api/sirkulasi/perpanjang", () => {
  it("returns 501 because renewal is offline", async () => {
    const response = await route.POST();

    expect(response.status).toBe(501);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    await expect(response.json()).resolves.toEqual({
      error: "Perpanjangan dilakukan offline melalui pustakawan.",
    });
  });
});
