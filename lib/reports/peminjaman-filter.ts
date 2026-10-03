import { LoanStatus } from "@/app/generated/prisma/client";
import {
  parseEnum,
  parseOptionalString,
  parseReportPeriod,
  parseSearch,
  parseUuid,
  type ReportDateRange,
  type ValidationResult,
} from "@/lib/validation";

const MAX_CLASS_NAME_LENGTH = 50;

export type PeminjamanReportFilters = {
  dateRange: ReportDateRange;
  status?: LoanStatus;
  className?: string;
  categoryId?: string;
  search?: string;
};

export function parsePeminjamanReportFilters(
  searchParams: URLSearchParams,
): ValidationResult<PeminjamanReportFilters> {
  const dateRangeResult = parseReportPeriod(searchParams);
  if (!dateRangeResult.ok) {
    return { ok: false, error: dateRangeResult.error };
  }

  const searchResult = parseSearch(searchParams);
  if (!searchResult.ok) {
    return { ok: false, error: searchResult.error };
  }

  const classNameResult = parseOptionalString(
    searchParams.get("className"),
    { field: "Kelas", maxLength: MAX_CLASS_NAME_LENGTH },
  );
  if (!classNameResult.ok) {
    return { ok: false, error: classNameResult.error };
  }

  const categoryIdResult = parseCategoryId(searchParams);
  if (!categoryIdResult.ok) {
    return { ok: false, error: categoryIdResult.error };
  }

  const statusResult = parseLoanStatus(searchParams);
  if (!statusResult.ok) {
    return { ok: false, error: statusResult.error };
  }

  return {
    ok: true,
    value: {
      dateRange: dateRangeResult.value,
      status: statusResult.value,
      className: classNameResult.value ?? undefined,
      categoryId: categoryIdResult.value,
      search: searchResult.value || undefined,
    },
  };
}

function parseCategoryId(
  searchParams: URLSearchParams,
): ValidationResult<string | undefined> {
  const rawValue = searchParams.get("categoryId")?.trim() ?? "";
  if (!rawValue) return { ok: true, value: undefined };

  const result = parseUuid(rawValue, "Category ID tidak valid.");
  return result.ok
    ? { ok: true, value: result.value }
    : { ok: false, error: result.error };
}

function parseLoanStatus(
  searchParams: URLSearchParams,
): ValidationResult<LoanStatus | undefined> {
  const rawValue = searchParams.get("status")?.trim() ?? "";
  if (!rawValue) return { ok: true, value: undefined };

  const result = parseEnum(
    rawValue,
    Object.values(LoanStatus),
    "Status peminjaman",
  );
  return result.ok
    ? { ok: true, value: result.value }
    : { ok: false, error: result.error };
}
