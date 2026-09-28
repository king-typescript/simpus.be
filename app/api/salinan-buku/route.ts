import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";
import type { BookStatus } from "@/app/generated/prisma/client";

export const runtime = "nodejs";

const err = (msg: string, status = 400) =>
  NextResponse.json({ error: msg }, { status, headers: noStoreHeaders });

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return err("Autentikasi diperlukan.", 401);

  const { searchParams } = new URL(request.url);
  const bookId = searchParams.get("bookId") ?? undefined;
  const status = (searchParams.get("status") as BookStatus) ?? undefined;
  const search = searchParams.get("search")?.trim();

  const data = await prisma.bookCopy.findMany({
    where: {
      isActive: true,
      ...(bookId && { bookId }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { barcode: { contains: search, mode: "insensitive" } },
          { book: { title: { contains: search, mode: "insensitive" } } },
        ],
      }),
    },
    include: {
      book: { select: { id: true, title: true, isbn: true } },
      shelf: { select: { id: true, code: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) return err("Akses ditolak.", auth.status);

  const body = await request.json().catch(() => null);
  if (!body?.bookId || !body?.barcode?.trim()) {
    return err("bookId dan barcode wajib diisi.", 422);
  }

  try {
    const copy = await prisma.bookCopy.create({
      data: {
        bookId: body.bookId,
        barcode: body.barcode.trim(),
        shelfId: body.shelfId || null,
        status: (body.status as BookStatus) || "TERSEDIA",
        conditionNote: body.conditionNote?.trim() || null,
        acquiredAt: body.acquiredAt ? new Date(body.acquiredAt) : new Date(),
      },
    });

    return NextResponse.json({ data: copy }, { status: 201, headers: noStoreHeaders });
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return err("Barcode sudah terdaftar.", 409);
    }
    return err("Gagal menambahkan salinan buku.", 500);
  }
}
