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

export function isJsonContentType(request: Request): boolean {
  return (
    request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json") ?? false
  );
}

/** Trust forwarded headers only when deployment proxy strips client-supplied values. */
export function getClientIp(request: Request): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
}
