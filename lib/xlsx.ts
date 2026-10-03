import ExcelJS from "exceljs";
import { isValidTimeZone } from "@/lib/date";
import type { PeminjamanReportItem } from "@/lib/reports/peminjaman";

const MAX_XLSX_ROWS = 10_000;

const columns = [
  { header: "ID Peminjaman", key: "loanId", width: 38 },
  { header: "ID Item", key: "loanItemId", width: 38 },
  { header: "Tanggal Pinjam", key: "loanDate", width: 20 },
  { header: "Tanggal Jatuh Tempo", key: "dueDate", width: 22 },
  { header: "Tanggal Kembali", key: "returnedAt", width: 20 },
  { header: "Status Peminjaman", key: "loanStatus", width: 24 },
  { header: "NIS", key: "nis", width: 18 },
  { header: "Nama Siswa", key: "studentName", width: 28 },
  { header: "Kelas", key: "className", width: 18 },
  { header: "Judul Buku", key: "bookTitle", width: 36 },
  { header: "Kategori", key: "categoryName", width: 24 },
  { header: "Hari Terlambat", key: "daysLate", width: 16 },
  {
    header: "Hari Terlambat Tercatat",
    key: "recordedFineDaysLate",
    width: 24,
  },
  { header: "Status Denda", key: "fineStatus", width: 20 },
  { header: "Jumlah Denda", key: "fineAmount", width: 18 },
] as const;

function sanitizeSpreadsheetText(value: string): string {
  return /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}

function formatDate(value: Date | null, timeZone: string): string {
  if (!value) return "";

  return new Intl.DateTimeFormat("id-ID", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

function requireTimeZone(timeZone: string): string {
  if (!isValidTimeZone(timeZone)) {
    throw new Error("Timezone laporan tidak valid.");
  }

  return timeZone;
}

function getExcelColumnName(columnNumber: number): string {
  let result = "";
  let number = columnNumber;

  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }

  return result;
}

function parseAmount(value: string | null): number | null {
  if (value === null) return null;

  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function addReportRow(
  worksheet: ExcelJS.Worksheet,
  item: PeminjamanReportItem,
  timeZone: string,
): void {
  worksheet.addRow({
    loanId: sanitizeSpreadsheetText(item.loanId),
    loanItemId: sanitizeSpreadsheetText(item.loanItemId),
    loanDate: formatDate(item.loanDate, timeZone),
    dueDate: formatDate(item.dueDate, timeZone),
    returnedAt: formatDate(item.returnedAt, timeZone),
    loanStatus: sanitizeSpreadsheetText(item.loanStatus),
    nis: sanitizeSpreadsheetText(item.student.nis),
    studentName: sanitizeSpreadsheetText(item.student.name),
    className: sanitizeSpreadsheetText(item.student.className),
    bookTitle: sanitizeSpreadsheetText(item.book.title),
    categoryName: sanitizeSpreadsheetText(item.book.category.name),
    daysLate: item.daysLate,
    recordedFineDaysLate: item.recordedFineDaysLate ?? null,
    fineStatus: item.fine
      ? sanitizeSpreadsheetText(item.fine.status)
      : "",
    fineAmount: parseAmount(item.fine?.amount ?? null),
  });
}

export async function createPeminjamanWorkbook(
  rows: readonly PeminjamanReportItem[],
  timeZone: string,
): Promise<Buffer> {
  if (rows.length > MAX_XLSX_ROWS) {
    throw new Error(
      `Jumlah baris XLSX maksimal ${MAX_XLSX_ROWS}.`,
    );
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Laporan Peminjaman");
  const reportTimeZone = requireTimeZone(timeZone);

  worksheet.columns = [...columns];
  worksheet.getRow(1).font = {
    bold: true,
    color: { argb: "FFFFFFFF" },
  };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "1F4E78" },
  };
  worksheet.getRow(1).alignment = {
    vertical: "middle",
    horizontal: "center",
    wrapText: true,
  };
  worksheet.getRow(1).height = 30;
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: "A1",
    to: `${getExcelColumnName(columns.length)}1`,
  };

  for (const item of rows) {
    addReportRow(worksheet, item, reportTimeZone);
  }

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    row.alignment = {
      vertical: "middle",
      wrapText: false,
    };
  });

  worksheet.getColumn("daysLate").numFmt = "0";
  worksheet.getColumn("recordedFineDaysLate").numFmt = "0";
  worksheet.getColumn("fineAmount").numFmt = "#,##0.00";

  worksheet.getColumn("daysLate").alignment = {
    horizontal: "right",
  };
  worksheet.getColumn("recordedFineDaysLate").alignment = {
    horizontal: "right",
  };
  worksheet.getColumn("fineAmount").alignment = {
    horizontal: "right",
  };

  worksheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  worksheet.headerFooter.oddFooter = "Halaman &P dari &N";

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
