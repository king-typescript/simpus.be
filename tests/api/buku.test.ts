import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), librarian: vi.fn(), findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), category: vi.fn(), authors: vi.fn(), authorCount: vi.fn(), audit: vi.fn(), transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ noStoreHeaders: { "Cache-Control": "no-store" }, requireAuthenticatedUser: mocks.auth, requireLibrarian: mocks.librarian }));
vi.mock("@/lib/prisma", () => ({ prisma: { book: { findMany: mocks.findMany, count: mocks.count, findFirst: mocks.findFirst, create: mocks.create, update: mocks.update }, $transaction: mocks.transaction } }));

const listRoute = await import("@/app/api/buku/route");
const detailRoute = await import("@/app/api/buku/[id]/route");

const librarian = { id: "11111111-1111-4111-8111-111111111111", role: "PUSTAKAWAN", status: "AKTIF" };
const user = { id: "22222222-2222-4222-8222-222222222222", role: "SISWA", status: "AKTIF" };
const bookId = "33333333-3333-4333-8333-333333333333";
const categoryId = "44444444-4444-4444-8444-444444444444";
const authorId = "55555555-5555-4555-8555-555555555555";
const copyId = "66666666-6666-4666-8666-666666666666";
const date = new Date("2026-09-30T08:00:00.000Z");

const book = { id: bookId, isbn: "9786020324787", title: "Pemrograman Dasar", isActive: true, publisher: "Penerbit", publicationYear: 2025, edition: "Edisi 1", description: "Deskripsi", coverUrl: "https://example.com/cover.jpg", createdAt: date, updatedAt: date, category: { id: categoryId, name: "Teknologi", ddcCode: "005" }, authors: [{ id: authorId, name: "Budi" }], _count: { copies: 2 } };
const detail = { ...book, category: { ...book.category, description: "Kategori" }, copies: [{ id: copyId, barcode: "COPY-001", status: "TERSEDIA", conditionNote: null, acquiredAt: date, shelf: { id: "77777777-7777-4777-8777-777777777777", code: "RAK-01", name: "Rak", location: "Lantai 1" } }] };
const { _count: _ignoredCount, ...bookWithoutCount } = book;
const listResponse = { ...bookWithoutCount, createdAt: date.toISOString(), updatedAt: date.toISOString(), copyCount: 2 };
const detailResponse = { ...detail, createdAt: date.toISOString(), updatedAt: date.toISOString(), copies: [{ ...detail.copies[0], acquiredAt: date.toISOString() }] };

function req(method: string, url = "http://localhost/api/buku", body?: unknown) { return new Request(url, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
function ctx(id = bookId) { return { params: Promise.resolve({ id }) }; }
function valid(overrides: Record<string, unknown> = {}) { return { isbn: book.isbn, title: book.title, publisher: book.publisher, publicationYear: 2025, edition: book.edition, description: book.description, coverUrl: book.coverUrl, categoryId, authorIds: [authorId], ...overrides }; }
async function error(response: Response, status: number, message: string) { expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("no-store"); await expect(response.json()).resolves.toEqual({ error: message }); }
function tx() { return { book: { findFirst: mocks.findFirst, create: mocks.create, update: mocks.update }, category: { findFirst: mocks.category }, author: { findMany: mocks.authors, count: mocks.authorCount }, auditLog: { create: mocks.audit } }; }

type Tx = ReturnType<typeof tx>;
type Callback = (client: Tx) => unknown | Promise<unknown>;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user });
  mocks.librarian.mockResolvedValue({ ok: true, user: librarian });
  mocks.findMany.mockResolvedValue([book]); mocks.count.mockResolvedValue(1); mocks.findFirst.mockResolvedValue(detail);
  mocks.category.mockResolvedValue({ id: categoryId }); mocks.authors.mockResolvedValue([{ id: authorId }]); mocks.authorCount.mockResolvedValue(1); mocks.create.mockResolvedValue(detail); mocks.update.mockResolvedValue(detail); mocks.audit.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (operation: Callback | readonly unknown[]) => typeof operation === "function" ? operation(tx()) : Promise.all(operation));
});

describe("GET /api/buku", () => {
  it("requires authentication", async () => { mocks.auth.mockResolvedValue({ ok: false, status: 401 }); await error(await listRoute.GET(req("GET")), 401, "Autentikasi diperlukan."); });
  it("returns paginated books and maps copyCount", async () => {
    const response = await listRoute.GET(req("GET"));
    expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual({ data: [listResponse], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 20, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: expect.any(Object) }));
  });
  it("applies filters and pagination", async () => { await listRoute.GET(req("GET", `http://localhost/api/buku?page=2&limit=25&search=program&categoryId=${categoryId}&authorId=${authorId}&status=TERSEDIA`)); expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 25, take: 25, where: expect.objectContaining({ categoryId, authors: { some: { id: authorId } }, copies: { some: { status: "TERSEDIA" } }, OR: expect.any(Array) }) })); });
  it("rejects invalid filters", async () => { await error(await listRoute.GET(req("GET", "http://localhost/api/buku?categoryId=bad")), 422, "ID filter tidak valid."); await error(await listRoute.GET(req("GET", "http://localhost/api/buku?status=bad")), 422, "Status buku tidak valid."); });
  it("returns 500 on query failure", async () => { mocks.findMany.mockRejectedValue(new Error("DB")); await error(await listRoute.GET(req("GET")), 500, "Terjadi kesalahan pada server."); });
});

describe("POST /api/buku", () => {
  it.each([401, 403])("requires librarian: %s", async status => { mocks.librarian.mockResolvedValue({ ok: false, status }); await error(await listRoute.POST(req("POST", undefined, valid())), status, "Tidak memiliki akses."); });
  it("rejects malformed and non-object bodies", async () => { const malformed = new Request("http://localhost/api/buku", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }); await error(await listRoute.POST(malformed), 400, "Body JSON tidak valid."); for (const body of [null, [], "x", 1]) await error(await listRoute.POST(req("POST", undefined, body)), 422, "Body request tidak valid."); });
  it.each([valid({ title: "" }), valid({ title: "x".repeat(301) }), valid({ categoryId: "bad" }), valid({ authorIds: [] }), valid({ authorIds: ["bad"] }), valid({ isbn: "bad" }), valid({ coverUrl: "http://example.com/x" }), valid({ publicationYear: 999 })])("rejects invalid data", async body => { await error(await listRoute.POST(req("POST", undefined, body)), 422, "Data buku tidak valid."); });
  it("deduplicates author IDs before persistence", async () => {
    const response = await listRoute.POST(req("POST", undefined, valid({ authorIds: [authorId, authorId] })));
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authors: { connect: [{ id: authorId }] } }),
    }));
  });
  it("rejects missing category or author", async () => { mocks.category.mockResolvedValue(null); await error(await listRoute.POST(req("POST", undefined, valid())), 422, "Kategori tidak ditemukan."); mocks.category.mockResolvedValue({ id: categoryId }); mocks.authors.mockResolvedValue([]); await error(await listRoute.POST(req("POST", undefined, valid())), 422, "Salah satu penulis tidak ditemukan."); });
  it("creates book and audit log", async () => { const response = await listRoute.POST(req("POST", undefined, valid({ title: "  New Book  " }))); expect(response.status).toBe(201); expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: "New Book", categoryId, authors: { connect: [{ id: authorId }] } }) })); expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: librarian.id, action: "CREATE", entityType: "Book", entityId: bookId }) })); });
  it("maps duplicate ISBN to 409", async () => { mocks.transaction.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "P2002" })); await error(await listRoute.POST(req("POST", undefined, valid())), 409, "ISBN sudah digunakan."); });
});

describe("GET /api/buku/[id]", () => {
  it("returns 422 for invalid ID and 404 when absent", async () => { await error(await detailRoute.GET(req("GET"), ctx("bad")), 422, "ID buku tidak valid."); mocks.findFirst.mockResolvedValue(null); await error(await detailRoute.GET(req("GET"), ctx()), 404, "Buku tidak ditemukan."); });
  it("returns serialized detail", async () => { const response = await detailRoute.GET(req("GET"), ctx()); expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual({ data: detailResponse }); });
  it("returns 500 on query failure", async () => { mocks.findFirst.mockRejectedValue(new Error("DB")); await error(await detailRoute.GET(req("GET"), ctx()), 500, "Terjadi kesalahan pada server."); });
});

describe("PATCH /api/buku/[id]", () => {
  it.each([401, 403])("requires librarian: %s", async status => { mocks.librarian.mockResolvedValue({ ok: false, status }); await error(await detailRoute.PATCH(req("PATCH", undefined, { title: "X" }), ctx()), status, "Tidak memiliki akses."); });
  it("rejects invalid ID, body, and empty changes", async () => { await error(await detailRoute.PATCH(req("PATCH", undefined, {}), ctx("bad")), 422, "ID buku tidak valid."); await error(await detailRoute.PATCH(req("PATCH", undefined, {}), ctx()), 422, "Tidak ada perubahan."); await error(await detailRoute.PATCH(req("PATCH", undefined, { title: "" }), ctx()), 422, "Judul tidak valid."); });
  it("updates scalar nullable fields and authors", async () => { const response = await detailRoute.PATCH(req("PATCH", undefined, { isbn: null, publisher: null, edition: null, description: null, coverUrl: null, publicationYear: null, categoryId, authorIds: [authorId] }), ctx()); expect(response.status).toBe(200); expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: bookId }, data: expect.objectContaining({ isbn: null, publisher: null, edition: null, description: null, coverUrl: null, publicationYear: null, categoryId, authors: { set: [{ id: authorId }] } }) })); });
  it("maps missing book, category, author, and duplicate ISBN", async () => { mocks.findFirst.mockResolvedValue(null); await error(await detailRoute.PATCH(req("PATCH", undefined, { title: "X" }), ctx()), 404, "Buku tidak ditemukan."); mocks.findFirst.mockResolvedValue(detail); mocks.category.mockResolvedValue(null); await error(await detailRoute.PATCH(req("PATCH", undefined, { categoryId }), ctx()), 422, "Kategori tidak ditemukan."); mocks.category.mockResolvedValue({ id: categoryId }); mocks.authorCount.mockResolvedValue(0); await error(await detailRoute.PATCH(req("PATCH", undefined, { authorIds: [authorId] }), ctx()), 422, "Salah satu penulis tidak ditemukan."); });
});

describe("DELETE /api/buku/[id]", () => {
  it("deactivates active book and writes audit log", async () => { const response = await detailRoute.DELETE(req("DELETE"), ctx()); expect(response.status).toBe(204); expect(await response.text()).toBe(""); expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: bookId, isActive: true }, select: expect.any(Object) }); expect(mocks.update).toHaveBeenCalledWith({ where: { id: bookId }, data: { isActive: false } }); expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: librarian.id, action: "DEACTIVATE", entityType: "Book", entityId: bookId, oldData: expect.any(Object), newData: expect.any(Object), ipAddress: null }) }); });
  it("returns 404 for missing book and 500 on failure", async () => { mocks.findFirst.mockResolvedValue(null); await error(await detailRoute.DELETE(req("DELETE"), ctx()), 404, "Buku tidak ditemukan."); mocks.transaction.mockRejectedValue(new Error("DB")); await error(await detailRoute.DELETE(req("DELETE"), ctx()), 500, "Terjadi kesalahan pada server."); });
});
