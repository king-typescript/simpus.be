export const APP_TIMEZONE = "Asia/Makassar";

const DATE_FORMATTER_OPTIONS = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
} as const;

/**
 * Memvalidasi nama timezone IANA.
 *
 * Contoh:
 * - Asia/Jakarta
 * - Asia/Makassar
 * - Asia/Jayapura
 * - America/New_York
 */
export function isValidTimeZone(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 100
  ) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).format();

    return true;
  } catch {
    return false;
  }
}

/**
 * Mengembalikan tanggal dalam format YYYY-MM-DD sesuai timezone yang diberikan.
 */
export function getDateString(
  date: Date = new Date(),
  timeZone: string = APP_TIMEZONE,
): string {
  if (!isValidTimeZone(timeZone)) {
    throw new RangeError(`Timezone tidak valid: ${timeZone}`);
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    ...DATE_FORMATTER_OPTIONS,
    timeZone,
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Mengembalikan tanggal hari ini sesuai timezone aplikasi.
 *
 * Dipertahankan untuk kebutuhan internal yang memakai APP_TIMEZONE.
 */
export function getTodayDateString(date: Date = new Date()): string {
  return getDateString(date, APP_TIMEZONE);
}
