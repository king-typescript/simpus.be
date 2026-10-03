export type CsvValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined;

function sanitizeSpreadsheetText(value: string): string {
  return /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}

function formatCsvValue(value: CsvValue, delimiter: string): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const text = sanitizeSpreadsheetText(String(value));

  if (text.includes(delimiter) || /["\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

export function createCsv(
  headers: readonly string[],
  rows: readonly (readonly CsvValue[])[],
  delimiter = ",",
): string {
  if (!delimiter || /[\r\n"]/.test(delimiter)) {
    throw new Error("Delimiter CSV tidak valid.");
  }

  const headerRow = headers
    .map((header) => formatCsvValue(header, delimiter))
    .join(delimiter);

  const dataRows = rows.map((row) => {
    if (row.length !== headers.length) {
      throw new Error("Jumlah kolom CSV tidak sesuai header.");
    }

    return row
      .map((value) => formatCsvValue(value, delimiter))
      .join(delimiter);
  });

  return `\uFEFF${[headerRow, ...dataRows].join("\r\n")}\r\n`;
}
