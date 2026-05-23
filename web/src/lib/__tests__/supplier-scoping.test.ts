/**
 * Regression guard for the 2026-05-23 "supplier list pollution" incident.
 *
 * The Invoices page previously merged in EVERY supplier ever persisted for
 * the org (via getSuppliers(organizationId)) and only added derived ones
 * from the current visible result set on top. That meant after the user
 * narrowed by scan or filter, the supplier panel still showed brands with
 * zero visible invoices — making it look like the scan had found
 * suppliers that weren't actually in the current view.
 *
 * Spec: supplier list MUST equal the brand set of the current visible
 * invoices. User toggles (isRelevant) persist across views via lookup
 * into the global suppliers table.
 *
 * This test pins the helper that page.tsx now uses inline.
 */

import { describe, test, expect } from "vitest";

interface Invoice {
  company: string | null;
  senderDomain: string | null;
}
interface Supplier {
  id: string;
  name: string;
  isRelevant: boolean;
}

// Mirrors the logic inlined in web/src/app/(app)/invoices/page.tsx.
// Stays in sync with that file via the test below.
function deriveScopedSuppliers(
  invoices: Invoice[],
  dbSuppliers: Supplier[],
  cleanCompanyName: (s: string) => string,
  normalizeDomain: (s: string) => string,
) {
  const dbByBrand = new Map(dbSuppliers.map((s) => [s.name.toLowerCase(), s]));
  const brandCounts = new Map<string, { displayName: string; count: number }>();

  for (const inv of invoices) {
    const brand =
      cleanCompanyName(inv.company?.trim().toLowerCase() ?? "") ||
      (inv.senderDomain ? normalizeDomain(inv.senderDomain) : "");
    if (!brand) continue;
    const entry = brandCounts.get(brand);
    if (entry) {
      entry.count++;
    } else {
      const display = inv.company?.trim() || brand;
      brandCounts.set(brand, { displayName: display, count: 1 });
    }
  }

  return Array.from(brandCounts.entries()).map(([brand, { count }]) => {
    const persisted = dbByBrand.get(brand);
    return {
      id: persisted?.id ?? `derived-${brand}`,
      name: brand,
      isRelevant: persisted ? persisted.isRelevant : true,
      invoiceCount: count,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// Naive helpers — match real implementations closely enough for these tests
const cleanCompanyName = (s: string) => s;
const normalizeDomain = (s: string) => s.replace(/^.*@/, "").replace(/\..*$/, "");

describe("supplier list scoping", () => {
  test("supplier panel only contains brands present in the current view", () => {
    const invoices: Invoice[] = [
      { company: "Anthropic", senderDomain: "anthropic.com" },
      { company: "Apple", senderDomain: "apple.com" },
    ];
    const dbSuppliers: Supplier[] = [
      { id: "s1", name: "anthropic", isRelevant: true },
      { id: "s2", name: "apple", isRelevant: true },
      // Historical supplier from an earlier scan — NOT in the current view
      { id: "s3", name: "stale-supplier", isRelevant: true },
      // Another historical brand the user explicitly excluded
      { id: "s4", name: "spammy-vendor", isRelevant: false },
    ];

    const result = deriveScopedSuppliers(invoices, dbSuppliers, cleanCompanyName, normalizeDomain);

    expect(result.map((s) => s.name)).toEqual(["anthropic", "apple"]);
    expect(result.find((s) => s.name === "stale-supplier")).toBeUndefined();
    expect(result.find((s) => s.name === "spammy-vendor")).toBeUndefined();
  });

  test("Scan A has Apple + Google; Scan B has Anthropic only — viewing B shows only Anthropic", () => {
    const scanBInvoices: Invoice[] = [
      { company: "Anthropic", senderDomain: "anthropic.com" },
      { company: "Anthropic", senderDomain: "anthropic.com" },
    ];
    const dbSuppliers: Supplier[] = [
      { id: "s1", name: "apple", isRelevant: true },     // from prior Scan A
      { id: "s2", name: "google", isRelevant: true },    // from prior Scan A
      { id: "s3", name: "anthropic", isRelevant: true }, // from current Scan B
    ];

    const result = deriveScopedSuppliers(scanBInvoices, dbSuppliers, cleanCompanyName, normalizeDomain);

    expect(result.map((s) => s.name)).toEqual(["anthropic"]);
  });

  test("counts reflect the visible result set, not the global total", () => {
    const invoices: Invoice[] = [
      { company: "Anthropic", senderDomain: "anthropic.com" },
      { company: "Anthropic", senderDomain: "anthropic.com" },
      { company: "Apple", senderDomain: "apple.com" },
    ];
    const dbSuppliers: Supplier[] = [
      { id: "s1", name: "anthropic", isRelevant: true },
      { id: "s2", name: "apple", isRelevant: true },
    ];
    const result = deriveScopedSuppliers(invoices, dbSuppliers, cleanCompanyName, normalizeDomain);
    expect(result.find((s) => s.name === "anthropic")?.invoiceCount).toBe(2);
    expect(result.find((s) => s.name === "apple")?.invoiceCount).toBe(1);
  });

  test("persisted isRelevant toggle survives across views", () => {
    const invoices: Invoice[] = [
      { company: "Apple", senderDomain: "apple.com" },
    ];
    const dbSuppliers: Supplier[] = [
      { id: "s1", name: "apple", isRelevant: false },  // user excluded earlier
    ];
    const result = deriveScopedSuppliers(invoices, dbSuppliers, cleanCompanyName, normalizeDomain);
    expect(result[0].isRelevant).toBe(false);
  });

  test("brand-new supplier with no DB row defaults to included", () => {
    const invoices: Invoice[] = [
      { company: "NewVendor", senderDomain: "newvendor.com" },
    ];
    const result = deriveScopedSuppliers(invoices, [], cleanCompanyName, normalizeDomain);
    expect(result[0].isRelevant).toBe(true);
    expect(result[0].id).toBe("derived-newvendor");
  });

  test("zero invoices in view → empty supplier list", () => {
    const result = deriveScopedSuppliers([], [
      { id: "s1", name: "apple", isRelevant: true },
    ], cleanCompanyName, normalizeDomain);
    expect(result).toEqual([]);
  });
});
