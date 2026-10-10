import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreHeaders, requireAuthenticatedUser } from "@/lib/auth";
import { parsePagination, parseSearch } from "@/lib/validation";

export const runtime = "nodejs";

const MAX_LIMIT = 100;

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return errorResponse("Autentikasi diperlukan.", auth.status);

  const url = new URL(request.url);
  const pagination = parsePagination(url.searchParams, {
    defaultLimit: 20,
    maxLimit: MAX_LIMIT,
    maxPage: 10_000,
  });
  if (!pagination.ok) return errorResponse(pagination.error, 422);

  const search = parseSearch(url.searchParams);
  if (!search.ok) return errorResponse(search.error, 422);

  const where = {
    schoolId: auth.schoolId,
    className: {
      not: "",
      ...(search.value ? { contains: search.value, mode: "insensitive" as const } : {}),
    },
  };
  const { page, limit } = pagination.value;

  try {
    const [classes, totalGroups] = await prisma.$transaction([
      prisma.student.groupBy({
        by: ["className"],
        where,
        _count: { _all: true },
        orderBy: { className: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.student.groupBy({
        by: ["className"],
        where,
        orderBy: { className: "asc" },
      }),
    ]);

    return NextResponse.json(
      {
        data: classes.map((entry) => ({
          name: entry.className,
          studentCount: typeof entry._count === "object" && entry._count !== null
            ? entry._count._all ?? 0
            : 0,
        })),
        pagination: {
          page,
          limit,
          total: totalGroups.length,
          totalPages: Math.ceil(totalGroups.length / limit),
        },
      },
      { headers: noStoreHeaders },
    );
  } catch {
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
