/**
 * Regression tests for H10-dashboard/S5 — dashboard trust:
 *  - formatCurrencyCompact keeps the Total Amount KPI card from overflowing
 *    (compact ₪1.2M for large values, exact passthrough for small ones)
 *  - recentInvoicesWhere excludes not_invoice junk from Recent Invoices
 */
import { describe, test, expect, vi } from "vitest";

import { formatCurrency } from "@/lib/utils";
import { formatCurrencyCompact } from "@/lib/format";

// dashboard.ts imports the Prisma client at module scope — mock it so the
// pure recentInvoicesWhere helper can be imported without a database.
vi.mock("@/lib/db", () => ({ db: {} }));
import { recentInvoicesWhere } from "@/lib/data/dashboard";

describe("formatCurrencyCompact", () => {
  test("compacts millions to a short suffix form (₪1.2M)", () => {
    const compact = formatCurrencyCompact(1234567.89);
    expect(compact).toContain("1.2M");
    expect(compact).toContain("₪");
    // Materially shorter than the full string — the whole point of the card fix
    expect(compact.length).toBeLessThan(formatCurrency(1234567.89).length);
  });

  test("compacts hundreds of thousands (₪150K)", () => {
    expect(formatCurrencyCompact(150000)).toContain("150K");
  });

  test("compact threshold starts exactly at 100,000", () => {
    expect(formatCurrencyCompact(100000)).toContain("100K");
    // Just below the compact threshold: full digits, no suffix
    const below = formatCurrencyCompact(99000);
    expect(below).not.toMatch(/[KM]/);
    expect(below).toContain("99,000");
  });

  test("mid-range (10K–100K) keeps full digits but drops decimals", () => {
    const mid = formatCurrencyCompact(45231.4);
    expect(mid).toContain("45,231");
    expect(mid).not.toContain(".");
  });

  test("small amounts are exactly formatCurrency (passthrough)", () => {
    expect(formatCurrencyCompact(842.5)).toBe(formatCurrency(842.5));
    expect(formatCurrencyCompact(9999.5)).toBe(formatCurrency(9999.5));
    expect(formatCurrencyCompact(0)).toBe(formatCurrency(0));
  });

  test("negative large amounts compact by absolute value", () => {
    expect(formatCurrencyCompact(-1234567)).toContain("1.2M");
  });

  test("normalizes currency symbols and lowercase codes", () => {
    expect(formatCurrencyCompact(2512345, "$")).toContain("2.5M");
    expect(formatCurrencyCompact(2512345, "$")).toContain("$");
    expect(formatCurrencyCompact(2512345, "usd")).toContain("$");
    expect(formatCurrencyCompact(1234567.89, "₪")).toContain("₪");
  });

  test("falls back to ILS on an invalid currency code instead of throwing", () => {
    const s = formatCurrencyCompact(150000, "NOT_A_CODE");
    expect(s).toContain("150K");
    expect(s).toContain("₪");
  });
});

describe("recentInvoicesWhere", () => {
  test("scopes to the given organization", () => {
    expect(recentInvoicesWhere("org_123").organizationId).toBe("org_123");
  });

  test("excludes not_invoice junk tier from Recent Invoices", () => {
    const where = recentInvoicesWhere("org_123");
    expect(where.classificationTier).toEqual({ not: "not_invoice" });
  });

  test("does not silently narrow to an allowlist (all real tiers stay visible)", () => {
    const where = recentInvoicesWhere("org_123");
    // Exactly the two keys — no extra hidden filters that could blank the card
    expect(Object.keys(where).sort()).toEqual(
      ["classificationTier", "organizationId"].sort()
    );
  });
});
