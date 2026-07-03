/**
 * S1/M12/M14 — getSupplierKeyCounts:
 *   • groups on the persisted Invoice.supplierKey (indexed) as the primary
 *     source, with a canonicalSupplierKey fallback for legacy NULL rows;
 *   • buckets empty/unresolvable identities under "unknown" (M12);
 *   • scopes the groupBy to the current view's scan/tier/report facets so
 *     chip counts match the visible list (M14);
 * plus the getInvoices company facet filtering by canonical supplierKey.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    invoice: {
      groupBy: mocks.groupBy,
      findMany: mocks.findMany,
    },
  },
}));

import { getSupplierKeyCounts, getInvoices } from "@/lib/data/invoices";

beforeEach(() => {
  mocks.groupBy.mockReset();
  mocks.findMany.mockReset();
  mocks.findMany.mockResolvedValue([]);
});

/** Dispatch the two groupBy calls (keyed vs legacy) on their `by` clause. */
function mockGroupBys(
  keyedRows: Array<{ supplierKey: string | null; _count: number }>,
  legacyRows: Array<{ company: string | null; senderDomain: string | null; _count: number }>
) {
  mocks.groupBy.mockImplementation((args: any) => {
    if (args.by.includes("supplierKey")) return Promise.resolve(keyedRows);
    return Promise.resolve(legacyRows);
  });
}

describe("getSupplierKeyCounts", () => {
  test("merges persisted supplierKey counts with legacy resolver fallback", async () => {
    mockGroupBys(
      [
        { supplierKey: "anthropic", _count: 3 },
        { supplierKey: "unknown", _count: 1 },
      ],
      [
        // Legacy row (NULL supplierKey) resolving to the same brand — counts merge.
        { company: "Anthropic, PBC", senderDomain: "mail.anthropic.com", _count: 2 },
        // Legacy row with no identity at all — buckets under "unknown".
        { company: null, senderDomain: null, _count: 4 },
      ]
    );

    const counts = await getSupplierKeyCounts("org_1");

    expect(counts.get("anthropic")).toBe(5);
    expect(counts.get("unknown")).toBe(5);
    expect(counts.size).toBe(2);
  });

  test("scopes both groupBys to scan/tier/report facets (M14)", async () => {
    mockGroupBys([], []);
    await getSupplierKeyCounts("org_1", {
      scanId: "scan_9",
      tier: "confirmed_invoice",
      reportStatus: "EXCLUDED",
    });

    expect(mocks.groupBy).toHaveBeenCalledTimes(2);
    for (const call of mocks.groupBy.mock.calls) {
      expect(call[0].where).toMatchObject({
        organizationId: "org_1",
        scanId: "scan_9",
        classificationTier: "confirmed_invoice",
        reportStatus: "EXCLUDED",
      });
    }
  });

  test("invalid reportStatus values are not applied to the scope", async () => {
    mockGroupBys([], []);
    await getSupplierKeyCounts("org_1", { reportStatus: "ALL" });
    for (const call of mocks.groupBy.mock.calls) {
      expect(call[0].where.reportStatus).toBeUndefined();
    }
  });

  test("chip count equals the canonical-key-filtered list length for the same scope (M14)", async () => {
    // Two legacy company variants of the same brand: the chip must promise
    // exactly the rows a supplierKey/canonical filter would return.
    const rows = [
      { company: "AliExpress", senderDomain: "mail.aliexpress.com" },
      { company: "AliExpress.seller", senderDomain: "aliexpress.com" },
      { company: "Anthropic", senderDomain: "mail.anthropic.com" },
    ];
    mockGroupBys(
      [],
      rows.map((r) => ({ ...r, _count: 1 }))
    );
    const counts = await getSupplierKeyCounts("org_1");

    const { canonicalSupplierKey } = await import("@/lib/supplier-canonical");
    const filtered = rows.filter(
      (r) => canonicalSupplierKey(r) === "aliexpress"
    );
    expect(counts.get("aliexpress")).toBe(filtered.length);
    expect(filtered.length).toBe(2);
  });
});

describe("getInvoices company facet filters by canonical supplierKey (M14)", () => {
  test("display name and canonical key both resolve to the same supplierKey WHERE", async () => {
    await getInvoices("org_1", { company: "AliExpress" });
    await getInvoices("org_1", { company: "aliexpress" });

    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    const [byDisplay, byKey] = mocks.findMany.mock.calls.map((c) => c[0].where);
    expect(byDisplay.supplierKey).toBe("aliexpress");
    expect(byKey.supplierKey).toBe("aliexpress");
    // The old exact-display-name equality filter is gone.
    expect(byDisplay.company).toBeUndefined();
  });

  test("the unknown bucket is filterable too (M12)", async () => {
    await getInvoices("org_1", { company: "unknown" });
    expect(mocks.findMany.mock.calls[0][0].where.supplierKey).toBe("unknown");
  });
});
