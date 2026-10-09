import { NextResponse } from "next/server";
import {
  noStoreHeaders,
  requireLibrarian,
} from "@/lib/auth";
import { createCsv } from "@/lib/csv";
import { createPeminjamanWorkbook } from "@/lib/xlsx";
import {
  getAllPeminjamanReport,
  ReportValidationError,
} from "@/lib/reports/peminjaman";
import { parsePeminjamanReportFilters } from "@/lib/reports/peminjaman-filter";
import { parseReportExportFormat } from "@/lib/validation";

export const runtime = "nodejs";

const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const REPORT_HEADERS = [
  "ID Peminjaman",
  "ID Item",
  "Tanggal Pinjam",
  "Tanggal Jatuh Tempo",
  "Tanggal Kembali",
  "Status Peminjaman",
  "NIS",
  "Nama Siswa",
  "Kelas",
  "Judul Buku",
  "Kategori",
  "Hari Terlambat",
  "Hari Terlambat Tercatat",
  "Status Denda",
  "Jumlah Denda",
] as const;

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: noStoreHeaders },
  );
}

function formatDate(value: Date | null, timeZone: string): string {
  if (!value) return "";

  return new Intl.DateTimeFormat("id-ID", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

function toCsvRows(
  rows: Awaited<ReturnType<typeof getAllPeminjamanReport>>,
  timeZone: string,
): string[][] {
  return rows.map((item) => [
    item.loanId,
    item.loanItemId,
    formatDate(item.loanDate, timeZone),
    formatDate(item.dueDate, timeZone),
    formatDate(item.returnedAt, timeZone),
    item.loanStatus,
    item.student.nis,
    item.student.name,
    item.student.className,
    item.book.title,
    item.book.category.name,
    String(item.daysLate),
    item.recordedFineDaysLate === null
      ? ""
      : String(item.recordedFineDaysLate),
    item.fine?.status ?? "",
    item.fine?.amount ?? "",
  ]);
}

function buildFileName(
  format: "csv" | "xlsx",
  fromDate: string,
  toDate: string,
): string {
  return `laporan-peminjaman-${fromDate}-${toDate}.${format}`;
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

  const formatResult = parseReportExportFormat(url.searchParams);

  if (!formatResult.ok) {
    return errorResponse(formatResult.error, 422);
  }

  const filters = filtersResult.value;

  try {
    const rows = await getAllPeminjamanReport({
      schoolId: auth.schoolId,
      from: filters.dateRange.from,
      toExclusive: filters.dateRange.toExclusive,
      status: filters.status,
      className: filters.className,
      categoryId: filters.categoryId,
      search: filters.search,
    });

    const { timeZone, fromDate, toDate } = filters.dateRange;
    const format = formatResult.value;
    const fileName = buildFileName(format, fromDate, toDate);

    if (format === "csv") {
      const csv = createCsv(
        REPORT_HEADERS,
        toCsvRows(rows, timeZone),
        ";",
      );

      return new NextResponse(csv, {
        status: 200,
        headers: {
          ...noStoreHeaders,
          "Content-Type": CSV_CONTENT_TYPE,
          "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      });
    }

    const workbook = await createPeminjamanWorkbook(rows, timeZone);

    return new NextResponse(new Uint8Array(workbook), {
      status: 200,
      headers: {
        ...noStoreHeaders,
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error: unknown) {
    if (error instanceof ReportValidationError) {
      return errorResponse(error.message, error.status);
    }

    console.error("Gagal mengekspor laporan peminjaman.", error);
    return errorResponse("Terjadi kesalahan pada server.", 500);
  }
}
