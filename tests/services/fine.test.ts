import { describe, expect, it } from "vitest";
import { Prisma } from "@/app/generated/prisma/client";
import { calculateDaysLate, calculateFine } from "@/lib/fine";

describe("calculateDaysLate", () => {
  it("returns zero when reference date is before due date", () => {
    expect(
      calculateDaysLate(
        new Date("2026-09-10T00:00:00.000Z"),
        new Date("2026-09-09T23:59:59.999Z"),
      ),
    ).toBe(0);
  });

  it("returns zero when dates are on the same UTC calendar day", () => {
    expect(
      calculateDaysLate(
        new Date("2026-09-10T08:00:00.000Z"),
        new Date("2026-09-10T23:59:59.999Z"),
      ),
    ).toBe(0);
  });

  it("returns the number of late calendar days", () => {
    expect(
      calculateDaysLate(
        new Date("2026-09-10T00:00:00.000Z"),
        new Date("2026-09-15T12:30:00.000Z"),
      ),
    ).toBe(5);
  });

  it("handles month and year boundaries", () => {
    expect(
      calculateDaysLate(
        new Date("2026-12-31T00:00:00.000Z"),
        new Date("2027-01-02T00:00:00.000Z"),
      ),
    ).toBe(2);
  });
});

describe("calculateFine", () => {
  it("returns zero when there are no late days", () => {
    expect(calculateFine(0, new Prisma.Decimal("1500")).toString()).toBe("0");
  });

  it("multiplies late days by daily rate", () => {
    expect(calculateFine(3, new Prisma.Decimal("1500")).toString()).toBe("4500");
  });

  it("preserves decimal precision", () => {
    expect(calculateFine(4, new Prisma.Decimal("1250.50")).toString()).toBe("5002");
  });

  it("returns zero when daily rate is zero", () => {
    expect(calculateFine(10, new Prisma.Decimal("0")).toString()).toBe("0");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid late days: %s",
    (daysLate) => {
      expect(() => calculateFine(daysLate, new Prisma.Decimal("1500"))).toThrow(
        "daysLate must be a non-negative integer.",
      );
    },
  );
});
