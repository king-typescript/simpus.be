import {
  FineStatus,
  LoanStatus,
  Prisma,
} from "@/app/generated/prisma/client";
import { calculateDaysLate } from "@/lib/fine";
import { prisma } from "@/lib/prisma";

const MAX_REPORT_LIMIT = 100;
const MAX_REPORT_PAGE = 10_000;
const MAX_EXPORT_ITEMS = 10_000;
const MAX_SEARCH_LENGTH = 100;

export class ReportValidationError extends Error {
  readonly status = 422;

  constructor(message: string) {
    super(message);
    this.name = "ReportValidationError";
  }
}

export type PeminjamanReportFilter = {
  schoolId: string;
  from: Date;
  toExclusive: Date;
  status?: LoanStatus;
  className?: string;
  categoryId?: string;
  search?: string;
  page?: number;
  limit?: number;
  referenceDate?: Date;
};

export type PeminjamanReportItem = {
  loanId: string;
  loanItemId: string;
  loanDate: Date;
  dueDate: Date;
  returnedAt: Date | null;
  loanStatus: LoanStatus;
  student: {
    id: string;
    nis: string;
    name: string;
    className: string;
  };
  book: {
    id: string;
    title: string;
    category: {
      id: string;
      name: string;
    };
  };
  daysLate: number;
  recordedFineDaysLate: number | null;
  fine: {
    status: FineStatus;
    amount: string;
  } | null;
};

export type PeminjamanReportResult = {
  data: PeminjamanReportItem[];
  total: number;
};

const loanItemSelect = {
  id: true,
  returnedAt: true,
  loan: {
    select: {
      id: true,
      loanDate: true,
      dueDate: true,
      status: true,
      student: {
        select: {
          id: true,
          nis: true,
          name: true,
          className: true,
        },
      },
    },
  },
  copy: {
    select: {
      book: {
        select: {
          id: true,
          title: true,
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  },
  fine: {
    select: {
      daysLate: true,
      status: true,
      amount: true,
    },
  },
} satisfies Prisma.LoanItemSelect;

type ReportLoanItem = Prisma.LoanItemGetPayload<{
  select: typeof loanItemSelect;
}>;

function validateDateRange(from: Date, toExclusive: Date): void {
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(toExclusive.getTime()) ||
    from >= toExclusive
  ) {
    throw new ReportValidationError("Rentang tanggal laporan tidak valid.");
  }
}

function validatePagination(page: number, limit: number): void {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > MAX_REPORT_PAGE
  ) {
    throw new ReportValidationError("Parameter page tidak valid.");
  }

  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_REPORT_LIMIT
  ) {
    throw new ReportValidationError("Parameter limit tidak valid.");
  }
}

function validateFilter(filter: PeminjamanReportFilter): void {
  validateDateRange(filter.from, filter.toExclusive);

  if (filter.search && filter.search.trim().length > MAX_SEARCH_LENGTH) {
    throw new ReportValidationError("Parameter pencarian terlalu panjang.");
  }
}

async function validateCategoryScope(filter: PeminjamanReportFilter): Promise<void> {
  if (!filter.categoryId) return;

  const category = await prisma.category.findFirst({
    where: { id: filter.categoryId, schoolId: filter.schoolId, isActive: true },
    select: { id: true },
  });

  if (!category) throw new ReportValidationError("Kategori tidak ditemukan.");
}

function buildWhere(
  filter: PeminjamanReportFilter,
): Prisma.LoanItemWhereInput {
  const search = filter.search?.trim();
  const className = filter.className?.trim();

  return {
    schoolId: filter.schoolId,
    loan: {
      schoolId: filter.schoolId,
      loanDate: {
        gte: filter.from,
        lt: filter.toExclusive,
      },
      ...(filter.status ? { status: filter.status } : {}),
      ...(className ? { student: { className } } : {}),
    },
    ...(filter.categoryId
      ? { copy: { book: { categoryId: filter.categoryId } } }
      : {}),
    ...(search
      ? {
          OR: [
            {
              loan: {
                student: {
                  name: { contains: search, mode: "insensitive" },
                },
              },
            },
            {
              loan: {
                student: {
                  nis: { contains: search, mode: "insensitive" },
                },
              },
            },
            {
              loan: {
                student: {
                  className: { contains: search, mode: "insensitive" },
                },
              },
            },
            {
              copy: {
                book: {
                  title: { contains: search, mode: "insensitive" },
                },
              },
            },
            {
              copy: {
                book: {
                  category: {
                    name: { contains: search, mode: "insensitive" },
                  },
                },
              },
            },
          ],
        }
      : {}),
  };
}

function serializeFine(
  fine: ReportLoanItem["fine"],
): PeminjamanReportItem["fine"] {
  if (!fine) return null;

  return {
    status: fine.status,
    amount: fine.amount.toFixed(2),
  };
}

function serializeItem(
  item: ReportLoanItem,
  referenceDate: Date,
): PeminjamanReportItem {
  const effectiveDate = item.returnedAt ?? referenceDate;

  return {
    loanId: item.loan.id,
    loanItemId: item.id,
    loanDate: item.loan.loanDate,
    dueDate: item.loan.dueDate,
    returnedAt: item.returnedAt,
    loanStatus: item.loan.status,
    student: item.loan.student,
    book: item.copy.book,
    daysLate: calculateDaysLate(item.loan.dueDate, effectiveDate),
    recordedFineDaysLate: item.fine?.daysLate ?? null,
    fine: serializeFine(item.fine),
  };
}

async function queryPeminjamanReport(
  filter: PeminjamanReportFilter,
  options: { skip?: number; take?: number } = {},
): Promise<PeminjamanReportResult> {
  const where = buildWhere(filter);
  const [items, total] = await prisma.$transaction([
    prisma.loanItem.findMany({
      where,
      select: loanItemSelect,
      orderBy: [{ loan: { loanDate: "desc" } }, { id: "desc" }],
      ...(options.skip === undefined ? {} : { skip: options.skip }),
      ...(options.take === undefined ? {} : { take: options.take }),
    }),
    prisma.loanItem.count({ where }),
  ]);

  const referenceDate = filter.referenceDate ?? new Date();

  return {
    data: items.map((item) => serializeItem(item, referenceDate)),
    total,
  };
}

export async function getPeminjamanReport(
  filter: PeminjamanReportFilter,
): Promise<PeminjamanReportResult> {
  validateFilter(filter);
  await validateCategoryScope(filter);

  const page = filter.page ?? 1;
  const limit = filter.limit ?? 50;
  const referenceDate = filter.referenceDate ?? new Date();

  if (Number.isNaN(referenceDate.getTime())) {
    throw new ReportValidationError("Tanggal referensi laporan tidak valid.");
  }

  validatePagination(page, limit);

  return queryPeminjamanReport(filter, {
    skip: (page - 1) * limit,
    take: limit,
  });
}

export async function getAllPeminjamanReport(
  filter: Omit<PeminjamanReportFilter, "page" | "limit">,
): Promise<PeminjamanReportItem[]> {
  validateFilter(filter);
  await validateCategoryScope(filter);

  const referenceDate = filter.referenceDate ?? new Date();

  if (Number.isNaN(referenceDate.getTime())) {
    throw new ReportValidationError("Tanggal referensi laporan tidak valid.");
  }

  const result = await queryPeminjamanReport(filter, {
    take: MAX_EXPORT_ITEMS + 1,
  });

  if (result.total > MAX_EXPORT_ITEMS) {
    throw new Error(
      `Data export melebihi batas ${MAX_EXPORT_ITEMS} item. Gunakan filter yang lebih spesifik.`,
    );
  }

  return result.data;
}
