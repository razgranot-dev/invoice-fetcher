/**
 * M13 — getSuppliers must be a PURE READ (no write-on-read reconciliation),
 * and reconcileSuppliers (mutation-path only) must never destroy a user's
 * supplier exclusion:
 *   • stale excluded rows are RE-KEYED onto their current canonical key
 *     before deletion (alias-map changes keep the preference);
 *   • stale excluded rows that fail to re-key are kept dormant, not deleted;
 *   • only preference-free stale rows (isRelevant=true) are cleaned up.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  supplierFindMany: vi.fn(),
  supplierUpsert: vi.fn(),
  supplierDeleteMany: vi.fn(),
  supplierCreateMany: vi.fn(),
  supplierUpdateMany: vi.fn(),
  transaction: vi.fn(),
  getSupplierKeyCounts: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    supplier: {
      findMany: mocks.supplierFindMany,
      upsert: mocks.supplierUpsert,
      deleteMany: mocks.supplierDeleteMany,
      createMany: mocks.supplierCreateMany,
      updateMany: mocks.supplierUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/data/invoices", () => ({
  getSupplierKeyCounts: mocks.getSupplierKeyCounts,
}));

import { getSuppliers, reconcileSuppliers } from "@/lib/data/suppliers";

function supplierRow(overrides: Partial<{
  id: string; name: string; isRelevant: boolean;
}> & { name: string }) {
  return {
    id: overrides.id ?? `sup_${overrides.name}`,
    organizationId: "org_1",
    name: overrides.name,
    isRelevant: overrides.isRelevant ?? true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.supplierUpsert.mockResolvedValue({});
  mocks.supplierDeleteMany.mockResolvedValue({ count: 0 });
});

describe("getSuppliers is a pure read (M13)", () => {
  test("issues ZERO write calls and merges persisted rows with derived brands", async () => {
    mocks.getSupplierKeyCounts.mockResolvedValue(
      new Map([
        ["anthropic", 3],
        ["newbrand", 1],
      ])
    );
    mocks.supplierFindMany.mockResolvedValue([
      supplierRow({ name: "anthropic", isRelevant: false }),
    ]);

    const result = await getSuppliers("org_1");

    expect(mocks.supplierCreateMany).not.toHaveBeenCalled();
    expect(mocks.supplierUpdateMany).not.toHaveBeenCalled();
    expect(mocks.supplierDeleteMany).not.toHaveBeenCalled();
    expect(mocks.supplierUpsert).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();

    const anthropic = result.find((s) => s.name === "anthropic");
    expect(anthropic).toMatchObject({ isRelevant: false, invoiceCount: 3 });

    // Derived-only brand appears with default inclusion + its count.
    const derived = result.find((s) => s.name === "newbrand");
    expect(derived).toMatchObject({
      id: "derived-newbrand",
      isRelevant: true,
      invoiceCount: 1,
    });
  });

  test("persisted rows with zero current invoices are still returned (count 0)", async () => {
    mocks.getSupplierKeyCounts.mockResolvedValue(new Map());
    mocks.supplierFindMany.mockResolvedValue([
      supplierRow({ name: "spammy-vendor", isRelevant: false }),
    ]);
    const result = await getSuppliers("org_1");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "spammy-vendor", invoiceCount: 0 });
  });
});

describe("reconcileSuppliers preserves user exclusions (M13)", () => {
  test("stale excluded row 'bird rides' re-keys its exclusion onto 'bird' before deletion", async () => {
    mocks.getSupplierKeyCounts.mockResolvedValue(new Map([["bird", 2]]));
    mocks.supplierFindMany.mockResolvedValue([
      supplierRow({ id: "sup_stale", name: "bird rides", isRelevant: false }),
    ]);

    await reconcileSuppliers("org_1");

    expect(mocks.supplierUpsert).toHaveBeenCalledWith({
      where: { organizationId_name: { organizationId: "org_1", name: "bird" } },
      create: { organizationId: "org_1", name: "bird", isRelevant: false },
      update: { isRelevant: false },
    });
    expect(mocks.supplierDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["sup_stale"] } },
    });
    // The upsert must happen BEFORE the delete.
    expect(mocks.supplierUpsert.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.supplierDeleteMany.mock.invocationCallOrder[0]
    );
  });

  test("stale excluded row that fails to re-key is KEPT, never deleted", async () => {
    mocks.getSupplierKeyCounts.mockResolvedValue(new Map([["anthropic", 1]]));
    mocks.supplierFindMany.mockResolvedValue([
      // canonicalSupplierKey('dormantvendor') === 'dormantvendor' → no re-key.
      supplierRow({ id: "sup_dormant", name: "dormantvendor", isRelevant: false }),
    ]);

    await reconcileSuppliers("org_1");

    expect(mocks.supplierUpsert).not.toHaveBeenCalled();
    expect(mocks.supplierDeleteMany).not.toHaveBeenCalled();
  });

  test("preference-free stale rows are deleted without any upsert", async () => {
    mocks.getSupplierKeyCounts.mockResolvedValue(new Map([["apple", 5]]));
    mocks.supplierFindMany.mockResolvedValue([
      supplierRow({ id: "sup_old", name: "old-derived-brand", isRelevant: true }),
    ]);

    await reconcileSuppliers("org_1");

    expect(mocks.supplierUpsert).not.toHaveBeenCalled();
    expect(mocks.supplierDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["sup_old"] } },
    });
  });

  test("no stale rows → no writes at all", async () => {
    mocks.getSupplierKeyCounts.mockResolvedValue(new Map([["apple", 5]]));
    mocks.supplierFindMany.mockResolvedValue([supplierRow({ name: "apple" })]);

    await reconcileSuppliers("org_1");

    expect(mocks.supplierUpsert).not.toHaveBeenCalled();
    expect(mocks.supplierDeleteMany).not.toHaveBeenCalled();
  });

  test("the 'unknown' exclusion row survives reconciliation (M12/M13 interlock)", async () => {
    // Excluding the Unknown chip persists a supplier named 'unknown'. The
    // count map buckets unattributable rows under 'unknown', so the row is
    // NOT stale while such rows exist…
    mocks.getSupplierKeyCounts.mockResolvedValue(new Map([["unknown", 4]]));
    mocks.supplierFindMany.mockResolvedValue([
      supplierRow({ id: "sup_unknown", name: "unknown", isRelevant: false }),
    ]);
    await reconcileSuppliers("org_1");
    expect(mocks.supplierDeleteMany).not.toHaveBeenCalled();

    // …and even when no unknown rows remain, an excluded 'unknown' row fails
    // to re-key (canonical('unknown') === 'unknown') and is kept dormant.
    mocks.supplierDeleteMany.mockClear();
    mocks.getSupplierKeyCounts.mockResolvedValue(new Map([["apple", 1]]));
    await reconcileSuppliers("org_1");
    expect(mocks.supplierDeleteMany).not.toHaveBeenCalled();
  });
});
