import { NextResponse } from "next/server";

import { noStoreHeaders, requireStudent } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePagination, parseSearch } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses = ["AKTIF", "DIKEMBALIKAN", "KEDALUWARSA"] as const;

type RouteStatus = (typeof statuses)[number];

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders });
}

export async function GET(request: Request) {
  const auth = await requireStudent();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  const searchParams = new URL(request.url).searchParams;
  const pagination = parsePagination(searchParams, {
    defaultLimit: 20,
    maxLimit: 50,
    maxPage: 1000,
  });
  if (!pagination.ok) return errorResponse(pagination.error, 422);

  const search = parseSearch(searchParams, 100);
  if (!search.ok) return errorResponse(search.error, 422);

  const rawStatus = searchParams.get("status")?.trim() ?? "";
  if (rawStatus && !statuses.includes(rawStatus as RouteStatus)) {
    return errorResponse("Parameter status tidak valid.", 422);
  }

  const status = rawStatus ? rawStatus as RouteStatus : undefined;
  const { page, limit } = pagination.value;
  const where = {
    schoolId: auth.schoolId,
    studentId: auth.student.id,
    ...(status ? { status } : {}),
    ...(search.value
      ? {
          ebook: {
            book: {
              title: { contains: search.value, mode: "insensitive" as const },
            },
          },
        }
      : {}),
  };

  const [total, accesses] = await prisma.$transaction([
    prisma.ebookAccess.count({ where }),
    prisma.ebookAccess.findMany({
      where: { ...where, schoolId: auth.schoolId },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        ebookId: true,
        startedAt: true,
        expiresAt: true,
        returnedAt: true,
        lastAccessedAt: true,
        extensionCount: true,
        status: true,
        ebook: {
          select: {
            id: true,
            fileName: true,
            contentType: true,
            fileSize: true,
            status: true,
            book: {
              select: {
                id: true,
                title: true,
                isbn: true,
                coverUrl: true,
                authors: {
                  select: { id: true, name: true },
                  orderBy: { name: "asc" },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  return NextResponse.json({
    data: accesses.map((access) => ({
      id: access.id,
      ebookId: access.ebookId,
      startedAt: access.startedAt,
      expiresAt: access.expiresAt,
      returnedAt: access.returnedAt,
      lastAccessedAt: access.lastAccessedAt,
      extensionCount: access.extensionCount,
      status: access.status,
      ebook: {
        ...access.ebook,
        fileSize: access.ebook.fileSize.toString(),
      },
    })),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  }, { headers: noStoreHeaders });
}
