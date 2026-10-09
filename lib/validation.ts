import { isValidTimeZone } from "@/lib/date";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOnlyFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  requireAtLeastOne = false,
): boolean {
  const keys = Object.keys(value);

  return (
    (!requireAtLeastOne || keys.length > 0) &&
    keys.every((key) => fields.includes(key))
  );
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function parseUuid(
  value: unknown,
  error = "ID tidak valid.",
): ValidationResult<string> {
  return isUuid(value)
    ? { ok: true, value }
    : { ok: false, error };
}

export function parseRequiredString(
  value: unknown,
  options: {
    field: string;
    maxLength: number;
    minLength?: number;
    normalize?: boolean;
  },
): ValidationResult<string> {
  if (typeof value !== "string") {
    return { ok: false, error: `${options.field} tidak valid.` };
  }

  const normalized = options.normalize === false
    ? value.trim()
    : normalizeText(value);
  const minLength = options.minLength ?? 1;

  if (normalized.length < minLength || normalized.length > options.maxLength) {
    return { ok: false, error: `${options.field} tidak valid.` };
  }

  return { ok: true, value: normalized };
}

export function parseOptionalString(
  value: unknown,
  options: {
    field: string;
    maxLength: number;
    normalize?: boolean;
  },
): ValidationResult<string | null | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false, error: `${options.field} tidak valid.` };
  }

  const normalized = options.normalize === false
    ? value.trim()
    : normalizeText(value);

  if (normalized.length > options.maxLength) {
    return { ok: false, error: `${options.field} terlalu panjang.` };
  }

  return { ok: true, value: normalized || null };
}

export function parseInteger(
  value: unknown,
  options: {
    field: string;
    min: number;
    max: number;
  },
): ValidationResult<number> {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < options.min ||
    value > options.max
  ) {
    return { ok: false, error: `${options.field} tidak valid.` };
  }

  return { ok: true, value };
}

function parseQueryInteger(value: string, fallback: number, max: number) {
  if (!/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= max
    ? parsed
    : fallback;
}

export function parsePagination(
  searchParams: URLSearchParams,
  options: {
    defaultLimit?: number;
    maxLimit?: number;
    maxPage?: number;
  } = {},
): ValidationResult<{ page: number; limit: number }> {
  const defaultLimit = options.defaultLimit ?? 20;
  const maxLimit = options.maxLimit ?? 100;
  const maxPage = options.maxPage ?? 10_000;
  const rawPage = searchParams.get("page");
  const rawLimit = searchParams.get("limit");

  const page = rawPage === null ? 1 : parseQueryInteger(rawPage, -1, maxPage);
  const limit = rawLimit === null
    ? defaultLimit
    : parseQueryInteger(rawLimit, -1, maxLimit);

  if (page === null || page < 1 || page > maxPage) {
    return { ok: false, error: "Parameter page tidak valid." };
  }

  if (limit === null || limit < 1 || limit > maxLimit) {
    return { ok: false, error: "Parameter limit tidak valid." };
  }

  return { ok: true, value: { page, limit } };
}

export function parseSearch(
  searchParams: URLSearchParams,
  maxLength = 100,
): ValidationResult<string> {
  const search = (searchParams.get("search") ?? "").trim();

  if (search.length > maxLength) {
    return { ok: false, error: "Parameter pencarian terlalu panjang." };
  }

  return { ok: true, value: search };
}

export const REPORT_PERIODS = [
  "today",
  "week",
  "month",
] as const;

export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_EXPORT_FORMATS = [
  "csv",
  "xlsx",
] as const;

export type ReportExportFormat =
  (typeof REPORT_EXPORT_FORMATS)[number];

export function parseReportExportFormat(
  searchParams: URLSearchParams,
): ValidationResult<ReportExportFormat> {
  const rawFormat = searchParams.get("format")?.trim() ?? "";

  if (!REPORT_EXPORT_FORMATS.includes(rawFormat as ReportExportFormat)) {
    return {
      ok: false,
      error: "Parameter format tidak valid.",
    };
  }

  return {
    ok: true,
    value: rawFormat as ReportExportFormat,
  };
}

export type ReportDateRange = {
  period: ReportPeriod;
  timeZone: string;
  fromDate: string;
  toDate: string;
  from: Date;
  toExclusive: Date;
};

export function parseReportTimeZone(
  searchParams: URLSearchParams,
): ValidationResult<string> {
  const timeZone = searchParams.get("timeZone")?.trim() ?? "";

  if (!timeZone) {
    return { ok: false, error: "Parameter timeZone wajib diisi." };
  }

  if (!isValidTimeZone(timeZone)) {
    return { ok: false, error: "Parameter timeZone tidak valid." };
  }

  return { ok: true, value: timeZone };
}

function getDateParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
  };
}

function formatDateParts(year: number, month: number, day: number): string {
  return [
    year.toString().padStart(4, "0"),
    month.toString().padStart(2, "0"),
    day.toString().padStart(2, "0"),
  ].join("-");
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function getReportDateStrings(
  period: ReportPeriod,
  timeZone: string,
  now: Date,
): { fromDate: string; toDate: string } {
  const today = getDateParts(now, timeZone);
  const todayUtc = new Date(
    Date.UTC(today.year, today.month - 1, today.day),
  );

  let from = todayUtc;
  let to = todayUtc;

  if (period === "week") {
    const dayOfWeek = todayUtc.getUTCDay();
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    from = addDays(todayUtc, -daysSinceMonday);
    to = addDays(from, 6);
  } else if (period === "month") {
    from = new Date(Date.UTC(today.year, today.month - 1, 1));
    to = new Date(Date.UTC(today.year, today.month, 0));
  }

  return {
    fromDate: formatDateParts(
      from.getUTCFullYear(),
      from.getUTCMonth() + 1,
      from.getUTCDate(),
    ),
    toDate: formatDateParts(
      to.getUTCFullYear(),
      to.getUTCMonth() + 1,
      to.getUTCDate(),
    ),
  };
}

function getTimeZoneOffsetMilliseconds(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );

  const localTimeAsUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );

  return localTimeAsUtc - date.getTime();
}

function localDateStartToUtc(date: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const localTimeAsUtc = Date.UTC(year, month - 1, day);
  let result = new Date(localTimeAsUtc);

  // Recalculate offset after each conversion. This handles DST transitions.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = getTimeZoneOffsetMilliseconds(result, timeZone);
    const next = new Date(localTimeAsUtc - offset);

    if (next.getTime() === result.getTime()) {
      return next;
    }

    result = next;
  }

  return result;
}

function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  result.setUTCDate(result.getUTCDate() + days);

  return formatDateParts(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    result.getUTCDate(),
  );
}

export function parseReportPeriod(
  searchParams: URLSearchParams,
  now = new Date(),
): ValidationResult<ReportDateRange> {
  if (Number.isNaN(now.getTime())) {
    return {
      ok: false,
      error: "Tanggal referensi tidak valid.",
    };
  }

  const rawPeriod = searchParams.get("period")?.trim() ?? "";

  if (!REPORT_PERIODS.includes(rawPeriod as ReportPeriod)) {
    return {
      ok: false,
      error: "Parameter period tidak valid.",
    };
  }

  const timeZoneResult = parseReportTimeZone(searchParams);

  if (!timeZoneResult.ok) {
    return {
      ok: false,
      error: timeZoneResult.error,
    };
  }

  const period = rawPeriod as ReportPeriod;
  const timeZone = timeZoneResult.value;
  const { fromDate, toDate } = getReportDateStrings(period, timeZone, now);
  const toDateExclusive = addCalendarDays(toDate, 1);
  const from = localDateStartToUtc(fromDate, timeZone);
  const toExclusive = localDateStartToUtc(toDateExclusive, timeZone);

  return {
    ok: true,
    value: {
      period,
      timeZone,
      fromDate,
      toDate,
      from,
      toExclusive,
    },
  };
}

export function parseEnum<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): ValidationResult<T> {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return { ok: false, error: `${field} tidak valid.` };
  }

  return { ok: true, value: value as T };
}

export function parseHttpsUrl(
  value: unknown,
  field = "URL",
  maxLength = 2048,
): ValidationResult<string | null> {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false, error: `${field} tidak valid.` };
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    return { ok: false, error: `${field} tidak valid.` };
  }

  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:") {
      return { ok: false, error: `${field} tidak valid.` };
    }
  } catch {
    return { ok: false, error: `${field} tidak valid.` };
  }

  return { ok: true, value: normalized };
}

export function parseBookCoverUrl(
  value: unknown,
  field = "URL sampul",
): ValidationResult<string | null> {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false, error: `${field} tidak valid.` };
  }

  const normalized = value.trim();
  if (/^book-covers\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/i.test(normalized)) {
    return { ok: true, value: normalized };
  }

  return parseHttpsUrl(normalized, field);
}

export function isJsonContentType(request: Request): boolean {
  return (
    request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json") ?? false
  );
}

/** Use the LAST x-forwarded-for entry (added by our own proxy, client-controlled
 *  entries sit first and are spoofable). Falls back to x-real-ip. */
export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return request.headers.get("x-real-ip");
}
