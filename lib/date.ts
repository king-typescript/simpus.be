export const APP_TIMEZONE = "Asia/Makassar";

/**
 * Mengembalikan tanggal hari ini dalam format YYYY-MM-DD sesuai zona waktu Asia/Makassar (WITA, UTC+8).
 */
export function getTodayDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
