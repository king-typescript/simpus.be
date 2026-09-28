import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser, requireLibrarian } from "@/lib/auth";
import type { BookStatus } from "@/app/generated/prisma/client";

export const runtime = "nodejs";

const err = (msg: string, status = 400) =>
  NextResponse.json({ error: msg }, { status, headers: noStoreHeaders });

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteCtx) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return err("Autentikasi diperlukan.", 401);

  const { id } = await params;
  const copy = await prisma.bookCopy.findFirst({
    where: { id, isActive: true },
    include: {
      book: { select: { id: true, title: true, isbn: true } },
      shelf: { select: { id: true, code: true, name: true, location: true } },
    },
  });

  return copy
    ? NextResponse.json({ data: copy }, { headers: noStoreHeaders })
    : err("Salinan buku tidak ditemukan.", 404);
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const auth = await requireLibrarian();
  if (!auth.ok) return err("Akses ditolak.", auth.status);

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return err("Body request tidak valid.", 400);

  try {
    const updated = await prisma.bookCopy.update({
      where: { id },
      data: {
        ...(body.barcode && { barcode: body.barcode.trim() }),
        ...(body.shelfId !== undefined && { shelfId: body.shelfId }),
        ...(body.status && { status: body.status as BookStatus }),
        ...(body.conditionNote !== undefined && { conditionNote: body.conditionNote }),
        ...(body.acquiredAt && { acquiredAt: new Date(body.acquiredAt) }),
      },
    });

    return NextResponse.json({ data: updated }, { headers: noStoreHeaders });
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e) {
      if (e.code === "P2002") return err("Barcode sudah terdaftar.", 409);
      if (e.code === "P2025") return err("Salinan buku tidak ditemukan.", 404);
    }
    return err("Gagal memperbarui salinan buku.", 500);
  }
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const auth = await requireLibrarian();
  if (!auth.ok) return err("Akses ditolak.", auth.status);

  const { id } = await params;

  // Proteksi: jangan nonaktifkan jika sedang dipinjam
  const activeLoan = await prisma.loanItem.findFirst({
    where: { copyId: id, returnedAt: null, loan: { status: "AKTIF" } },
  });
  if (activeLoan) return err("Salinan buku sedang dalam peminjaman aktif.", 409);

  await prisma.bookCopy.update({
    where: { id },
    data: { isActive: false },
  });

  return new NextResponse(null, { status: 204 });
}
