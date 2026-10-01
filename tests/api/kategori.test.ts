import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  requireLibrarian: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  noStoreHeaders: { "Cache-Control": "no-store" },
  requireAuthenticatedUser: mocks.requireAuthenticatedUser,
  requireLibrarian: mocks.requireLibrarian,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: {
      findMany: mocks.findMany,
      count: mocks.count,
      findFirst: mocks.findFirst,
      create: mocks.create,
      update: mocks.update,
    },
    $transaction: mocks.transaction,
  },
}));

const listRoute = await import("@/app/api/kategori/route");
const detailRoute = await import("@/app/api/kategori/[id]/route");

const librarian = { id: "11111111-1111-4111-8111-111111111111", role: "PUSTAKAWAN", status: "AKTIF" };
const user = { id: "22222222-2222-4222-8222-222222222222", role: "SISWA", status: "AKTIF" };
const categoryId = "33333333-3333-4333-8333-333333333333";
const date = new Date("2026-09-30T08:00:00.000Z");
const category = { id: categoryId, name: "Teknologi", ddcCode: "005", description: "Kategori teknologi.", isActive: true, createdAt: date, updatedAt: date, _count: { books: 2 } };
const { _count: _ignoredCount, ...categoryWithoutCount } = category;
const responseCategory = { ...categoryWithoutCount, createdAt: date.toISOString(), updatedAt: date.toISOString(), activeBookCount: 2 };
const select = { id: true, name: true, ddcCode: true, description: true, isActive: true, createdAt: true, updatedAt: true, _count: { select: { books: { where: { isActive: true } } } } };

function req(method: string, url = "http://localhost/api/kategori", body?: unknown) { return new Request(url, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
function ctx(id = categoryId) { return { params: Promise.resolve({ id }) }; }
function valid(overrides: Record<string, unknown> = {}) { return { name: "Teknologi", ddcCode: "005", description: "Kategori teknologi.", ...overrides }; }
async function error(response: Response, status: number, message: string) { expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("no-store"); await expect(response.json()).resolves.toEqual({ error: message }); }
function tx() { return { category: { findFirst: mocks.findFirst, create: mocks.create, update: mocks.update }, auditLog: { create: mocks.audit } }; }
type Tx = ReturnType<typeof tx>;
type Callback = (client: Tx) => unknown | Promise<unknown>;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAuthenticatedUser.mockResolvedValue({ ok: true, user });
  mocks.requireLibrarian.mockResolvedValue({ ok: true, user: librarian });
  mocks.findMany.mockResolvedValue([category]); mocks.count.mockResolvedValue(1); mocks.findFirst.mockResolvedValue(category); mocks.create.mockResolvedValue(category); mocks.update.mockResolvedValue(category); mocks.audit.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (operation: Callback | readonly unknown[]) => typeof operation === "function" ? operation(tx()) : Promise.all(operation));
});

describe("GET /api/kategori", () => {
  it.each([401, 403])("requires authentication: %s", async status => { mocks.requireAuthenticatedUser.mockResolvedValue({ ok: false, status }); await error(await listRoute.GET(req("GET")), status, "Autentikasi diperlukan."); });
  it("returns paginated categories and exact query", async () => { const response = await listRoute.GET(req("GET")); expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual({ data: [responseCategory], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }); expect(mocks.findMany).toHaveBeenCalledWith({ where: { isActive: true }, select, orderBy: [{ name: "asc" }, { id: "asc" }], skip: 0, take: 20 }); });
  it("applies search, status, and pagination", async () => { await listRoute.GET(req("GET", "http://localhost/api/kategori?page=3&limit=25&search=%20tech%20&status=NONAKTIF")); expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: false, OR: [{ name: { contains: "tech", mode: "insensitive" } }, { ddcCode: { contains: "tech", mode: "insensitive" } }, { description: { contains: "tech", mode: "insensitive" } }] }, skip: 50, take: 25 })); });
  it.each(["0", "-1", "1.5", "bad"]) ("rejects invalid pagination %s", async value => { await error(await listRoute.GET(req("GET", `http://localhost/api/kategori?page=${value}&limit=${value}`)), 422, "Parameter page tidak valid."); });
  it("rejects invalid status and maps DB errors", async () => { await error(await listRoute.GET(req("GET", "http://localhost/api/kategori?status=BAD")), 422, "Status kategori tidak valid."); mocks.findMany.mockRejectedValue(new Error("DB")); await error(await listRoute.GET(req("GET")), 500, "Terjadi kesalahan pada server."); });
});

describe("POST /api/kategori", () => {
  it.each([401, 403])("requires librarian: %s", async status => { mocks.requireLibrarian.mockResolvedValue({ ok: false, status }); await error(await listRoute.POST(req("POST", undefined, valid())), status, "Tidak memiliki akses."); });
  it("rejects malformed, arrays, unknown fields, and invalid data", async () => { const malformed = new Request("http://localhost/api/kategori", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }); await error(await listRoute.POST(malformed), 400, "Body JSON tidak valid."); for (const body of [null, [], "x", { ...valid(), extra: true }, valid({ name: "" }), valid({ ddcCode: "ABC" }), valid({ description: 1 })]) await error(await listRoute.POST(req("POST", undefined, body)), 422, body && typeof body === "object" && !Array.isArray(body) && !("extra" in body) && ((body as { name?: unknown }).name === "" || (body as { ddcCode?: unknown }).ddcCode === "ABC" || (body as { description?: unknown }).description === 1) ? "Data kategori tidak valid." : "Body request tidak valid."); });
  it("accepts omitted or null description and normalizes fields", async () => { const { description: _description, ...body } = valid({ name: " Teknologi ", ddcCode: " 005.1 " }); const response = await listRoute.POST(req("POST", undefined, body)); expect(response.status).toBe(201); expect(mocks.create).toHaveBeenCalledWith({ data: { name: "Teknologi", ddcCode: "005.1", description: null, isActive: true }, select }); });
  it("creates category and audit log", async () => { const response = await listRoute.POST(req("POST", undefined, valid())); expect(response.status).toBe(201); await expect(response.json()).resolves.toEqual({ data: responseCategory }); expect(mocks.audit).toHaveBeenCalledWith({ data: { userId: librarian.id, action: "CREATE", entityType: "Category", entityId: categoryId, newData: { ...category, createdAt: date.toISOString(), updatedAt: date.toISOString() }, ipAddress: null } }); });
  it("maps duplicate and unexpected errors", async () => { mocks.transaction.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "P2002" })); await error(await listRoute.POST(req("POST", undefined, valid())), 409, "Kode DDC sudah digunakan."); mocks.transaction.mockRejectedValue(new Error("DB")); await error(await listRoute.POST(req("POST", undefined, valid())), 500, "Terjadi kesalahan pada server."); });
});

describe("GET /api/kategori/[id]", () => {
  it("validates ID and returns detail or 404", async () => { await error(await detailRoute.GET(req("GET"), ctx("bad")), 422, "ID kategori tidak valid."); mocks.findFirst.mockResolvedValue(null); await error(await detailRoute.GET(req("GET"), ctx()), 404, "Kategori tidak ditemukan."); });
  it("returns exact detail and maps errors", async () => { const response = await detailRoute.GET(req("GET"), ctx()); expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual({ data: responseCategory }); expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: categoryId, isActive: true }, select }); mocks.findFirst.mockRejectedValue(new Error("DB")); await error(await detailRoute.GET(req("GET"), ctx()), 500, "Terjadi kesalahan pada server."); });
});

describe("PATCH /api/kategori/[id]", () => {
  it.each([401, 403])("requires librarian: %s", async status => { mocks.requireLibrarian.mockResolvedValue({ ok: false, status }); await error(await detailRoute.PATCH(req("PATCH", undefined, { name: "New" }), ctx()), status, "Tidak memiliki akses."); });
  it("validates ID, body, and changes", async () => { await error(await detailRoute.PATCH(req("PATCH", undefined, {}), ctx("bad")), 422, "ID kategori tidak valid."); await error(await detailRoute.PATCH(req("PATCH", undefined, {}), ctx()), 422, "Tidak ada perubahan."); for (const [body, message] of [[{ name: "" }, "Nama kategori tidak valid."], [{ ddcCode: "ABC" }, "Kode DDC tidak valid."], [{ description: 1 }, "Deskripsi kategori tidak valid."] ] as const) await error(await detailRoute.PATCH(req("PATCH", undefined, body), ctx()), 422, message); });
  it("rejects arrays and unknown fields", async () => { await error(await detailRoute.PATCH(req("PATCH", undefined, []), ctx()), 422, "Body request tidak valid."); await error(await detailRoute.PATCH(req("PATCH", undefined, { name: "New", extra: true }), ctx()), 422, "Body request tidak valid."); });
  it("updates fields, clears description, and writes audit", async () => { const response = await detailRoute.PATCH(req("PATCH", undefined, { name: " New ", ddcCode: " 005.1 ", description: null }), ctx()); expect(response.status).toBe(200); expect(mocks.update).toHaveBeenCalledWith({ where: { id: categoryId }, data: { name: "New", ddcCode: "005.1", description: null }, select }); expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: librarian.id, action: "UPDATE", entityType: "Category", entityId: categoryId }) })); });
  it("maps missing, duplicate, and DB errors", async () => { mocks.findFirst.mockResolvedValue(null); await error(await detailRoute.PATCH(req("PATCH", undefined, { name: "New" }), ctx()), 404, "Kategori tidak ditemukan."); mocks.findFirst.mockResolvedValue(category); mocks.transaction.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "P2002" })); await error(await detailRoute.PATCH(req("PATCH", undefined, { name: "New" }), ctx()), 409, "Kode DDC sudah digunakan."); mocks.transaction.mockRejectedValue(new Error("DB")); await error(await detailRoute.PATCH(req("PATCH", undefined, { name: "New" }), ctx()), 500, "Terjadi kesalahan pada server."); });
});

describe("DELETE /api/kategori/[id]", () => {
  it.each([401, 403])("requires librarian: %s", async status => { mocks.requireLibrarian.mockResolvedValue({ ok: false, status }); await error(await detailRoute.DELETE(req("DELETE"), ctx()), status, "Tidak memiliki akses."); });
  it("validates ID and missing category", async () => { await error(await detailRoute.DELETE(req("DELETE"), ctx("bad")), 422, "ID kategori tidak valid."); mocks.findFirst.mockResolvedValue(null); await error(await detailRoute.DELETE(req("DELETE"), ctx()), 404, "Kategori tidak ditemukan."); });
  it("rejects category with books", async () => { mocks.findFirst.mockResolvedValue({ ...category, _count: { books: 1 } }); await error(await detailRoute.DELETE(req("DELETE"), ctx()), 409, "Kategori masih digunakan oleh buku."); });
  it("deactivates unused category with serializable transaction", async () => { mocks.findFirst.mockResolvedValue({ ...category, _count: { books: 0 } }); const calls: unknown[][] = []; mocks.transaction.mockImplementation(async (...args: unknown[]) => { calls.push(args); return (args[0] as Callback)(tx()); }); const response = await detailRoute.DELETE(req("DELETE"), ctx()); expect(response.status).toBe(204); expect(await response.text()).toBe(""); expect(calls[0][1]).toEqual({ isolationLevel: "Serializable" }); expect(mocks.update).toHaveBeenCalledWith({ where: { id: categoryId }, data: { isActive: false } }); });
  it("maps conflict and DB errors", async () => { mocks.transaction.mockRejectedValue(Object.assign(new Error("conflict"), { code: "P2034" })); await error(await detailRoute.DELETE(req("DELETE"), ctx()), 409, "Permintaan konflik, coba lagi."); mocks.transaction.mockRejectedValue(new Error("DB")); await error(await detailRoute.DELETE(req("DELETE"), ctx()), 500, "Terjadi kesalahan pada server."); });
});
