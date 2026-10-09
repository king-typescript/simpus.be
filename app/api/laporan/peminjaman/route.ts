import { NextResponse } from "next/server";
import {
  noStoreHeaders,
  requireLibrarian,
} from "@/lib/auth";
import {
  getPeminjamanReport,
  ReportValidationError,
} from "@/lib/reports/peminjaman";
import { parsePeminjamanReportFilters } from "@/lib/reports/peminjaman-filter";
import { parsePagination } from "@/lib/validation";

export const runtime = "nodejs";

const REPORT_MAX_LIMIT = 100;

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: noStoreHeaders },
  );
}

export async function GET(request: Request) {
  const auth = await requireLibrarian();
  if (!auth.ok) {
    return errorResponse("Tidak memiliki akses.", auth.status);
  }

  const url = new URL(request.url);
  const filtersResult = parsePeminjamanReportFilters(url.searchParams);
  if (!filtersResult.ok) {
    return errorResponse(filtersResult.error, 422);
  }

  const paginationResult = parsePagination(url.searchParams, {
    defaultLimit: 20,
    maxLimit: REPORT_MAX_LIMIT,
  });
  if (!paginationResult.ok) {
    return errorResponse(paginationResult.error, 422);
  }

  const filters = filtersResult.value;

  try {
    const report = await getPeminjamanReport({
      schoolId: auth.schoolId,
      from: filters.dateRange.from,
      toExclusive: filters.dateRange.toExclusive,
      status: filters.status,
      className: filters.className,
      categoryId: filters.categoryId,
      search: filters.search,
      page: paginationResult.value.page,
      limit: paginationResult.value.limit,
    });

    const { page, limit } = paginationResult.value;

    return NextResponse.json(
      {
        data: report.data,
        filters: {
          period: filters.dateRange.period,
          timeZone: filters.dateRange.timeZone,
          fromDate: filters.dateRange.fromDate,
          toDate: filters.dateRange.toDate,
          status: filters.status ?? null,
          className: filters.className ?? null,
          categoryId: filters.categoryId ?? null,
          search: filters.search ?? null,
        },
        pagination: {
          page,
          limit,
          total: report.total,
          totalPages: Math.ceil(report.total / limit),
        },
      },
      { headers: noStoreHeaders },
    );
  } catch (error: unknown) {
    if (error instanceof ReportValidationError) {
      return errorResponse(error.message, error.status);
    }

    console.error("Gagal mengambil laporan peminjaman.", error);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
