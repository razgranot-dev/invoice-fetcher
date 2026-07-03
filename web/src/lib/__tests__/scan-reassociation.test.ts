/**
 * H4 regression guard — a re-scan ("Run again") must never clobber a manual
 * include/exclude decision.
 *
 * Two halves:
 *   1. updateReportStatus (the PATCH /api/invoices/report-status path) must
 *      stamp reportStatusManual: true on every user decision.
 *   2. buildReassociationUpdates (used by the re-association loop in
 *      POST /api/scans) must split each chunk so manual rows only get their
 *      scanId refreshed — never a reportStatus write.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const { updateMany } = vi.hoisted(() => ({
  updateMany: vi.fn().mockResolvedValue({ count: 1 }),
}));

vi.mock("@/lib/db", () => ({
  db: { invoice: { updateMany } },
}));

import {
  buildReassociationUpdates,
  updateReportStatus,
} from "@/lib/data/invoices";

beforeEach(() => {
  updateMany.mockClear();
});

describe("updateReportStatus marks rows manual (H4)", () => {
  test("payload always carries reportStatusManual: true", async () => {
    await updateReportStatus("org_1", ["inv_a", "inv_b"], "EXCLUDED");
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["inv_a", "inv_b"] }, organizationId: "org_1" },
      data: { reportStatus: "EXCLUDED", reportStatusManual: true },
    });
  });

  test("also for INCLUDED (a manual promote must survive re-scans too)", async () => {
    await updateReportStatus("org_1", ["inv_c"], "INCLUDED");
    expect(updateMany.mock.calls[0][0].data).toEqual({
      reportStatus: "INCLUDED",
      reportStatusManual: true,
    });
  });
});

describe("buildReassociationUpdates preserves manual decisions (H4)", () => {
  const ids = ["gm_1", "gm_2", "gm_3"];

  test("returns exactly two ops: non-manual then manual", () => {
    const ops = buildReassociationUpdates("org_1", "scan_new", ids, "INCLUDED");
    expect(ops).toHaveLength(2);
    expect(ops[0].where.reportStatusManual).toBe(false);
    expect(ops[1].where.reportStatusManual).toBe(true);
  });

  test("non-manual rows re-associate AND receive the tier-default status", () => {
    const [nonManual] = buildReassociationUpdates("org_1", "scan_new", ids, "EXCLUDED");
    expect(nonManual.where).toEqual({
      organizationId: "org_1",
      gmailMessageId: { in: ids },
      reportStatusManual: false,
    });
    expect(nonManual.data).toEqual({ scanId: "scan_new", reportStatus: "EXCLUDED" });
  });

  test("manual rows ONLY get scanId refreshed — no reportStatus key at all", () => {
    for (const status of ["INCLUDED", "EXCLUDED"] as const) {
      const [, manual] = buildReassociationUpdates("org_1", "scan_new", ids, status);
      expect(manual.where).toEqual({
        organizationId: "org_1",
        gmailMessageId: { in: ids },
        reportStatusManual: true,
      });
      expect(manual.data).toEqual({ scanId: "scan_new" });
      // The property must be ABSENT, not merely undefined — updateMany would
      // treat an explicit undefined differently across Prisma versions.
      expect(Object.prototype.hasOwnProperty.call(manual.data, "reportStatus")).toBe(false);
    }
  });

  test("both ops stay scoped to the same org and message ids", () => {
    const ops = buildReassociationUpdates("org_9", "scan_x", ["gm_9"], "INCLUDED");
    for (const op of ops) {
      expect(op.where.organizationId).toBe("org_9");
      expect(op.where.gmailMessageId).toEqual({ in: ["gm_9"] });
      expect(op.data.scanId).toBe("scan_x");
    }
  });
});

/**
 * FIX 4 — the completion summary and stored scan.invoiceCount must be
 * computed from the ACTUAL persisted reportStatus (read back via
 * db.invoice.groupBy after re-association), NOT from invoiceRows' fresh
 * per-tier defaults.
 *
 * Bug: a confirmed_invoice has tier-default INCLUDED, so if the user manually
 * excluded it (H4 — buildReassociationUpdates preserves that EXCLUDED
 * decision, only refreshing scanId), the invoiceRows-based count still counted
 * it as "in report". The finish summary / invoiceCount then disagreed with
 * getScanById, which reads the live DB.
 *
 * Mirrors of the two count paths inlined in
 * web/src/app/api/scans/route.ts — keep in sync.
 */
function defaultReportStatus(tier: string): "INCLUDED" | "EXCLUDED" {
  if (tier === "confirmed_invoice" || tier === "likely_invoice") {
    return "INCLUDED";
  }
  return "EXCLUDED";
}

// The buggy path: count included from invoiceRows' per-tier defaults.
function includedFromTierDefaults(
  rows: Array<{ classificationTier: string }>
): number {
  return rows.filter((r) => defaultReportStatus(r.classificationTier) === "INCLUDED")
    .length;
}

// The fixed path: reduce db.invoice.groupBy({ by: ["reportStatus"] }) output,
// exactly as persistedReportCounts() (route.ts) and getScanById (scans.ts) do.
function persistedReportCounts(
  statusCounts: Array<{ reportStatus: "INCLUDED" | "EXCLUDED"; _count: number }>
): { included: number; excluded: number } {
  const counts = { included: 0, excluded: 0 };
  for (const row of statusCounts) {
    if (row.reportStatus === "INCLUDED") counts.included = row._count;
    else if (row.reportStatus === "EXCLUDED") counts.excluded = row._count;
  }
  return counts;
}

describe("summary counts come from persisted reportStatus, not tier defaults (FIX 4)", () => {
  test("a manually-excluded confirmed row is NOT counted as in-report", () => {
    // The user manually excluded a single confirmed_invoice. invoiceRows still
    // carries its tier default (INCLUDED); the DB has it as EXCLUDED.
    const invoiceRows = [{ classificationTier: "confirmed_invoice" }];
    const persistedGroupBy = [
      { reportStatus: "EXCLUDED" as const, _count: 1 },
    ];

    // The old, buggy count would have reported it "in report".
    expect(includedFromTierDefaults(invoiceRows)).toBe(1);

    // The fixed count reads the persisted state — 0 in report, 1 for review.
    const counts = persistedReportCounts(persistedGroupBy);
    expect(counts.included).toBe(0);
    expect(counts.excluded).toBe(1);
  });

  test("summary string reflects the persisted counts", () => {
    const counts = persistedReportCounts([
      { reportStatus: "INCLUDED", _count: 3 },
      { reportStatus: "EXCLUDED", _count: 2 },
    ]);
    const parts = [`Scanned 50`, `${counts.included} in report`];
    if (counts.excluded > 0) parts.push(`${counts.excluded} for review`);
    expect(`Complete — ${parts.join(" · ")}`).toBe(
      "Complete — Scanned 50 · 3 in report · 2 for review"
    );
  });

  test("empty groupBy (nothing persisted) counts as 0/0", () => {
    expect(persistedReportCounts([])).toEqual({ included: 0, excluded: 0 });
  });
});

/**
 * FIX 5 — the Word export button gating.
 *
 * Filter-mode WORD exports drop everything outside the confirmed/likely tier
 * whitelist (EXPORT_TIERS in export-selection.ts), while CSV/ZIP keep the
 * whole facet. Gating Word on the raw facet count enabled the button in the
 * For Review facet (report=EXCLUDED, mostly possible/other-tier rows), which
 * then 400'd "No invoices match". The fix gates Word on the count of
 * confirmed/likely rows WITHIN the current facet.
 *
 * Mirror of the gating computed in
 * web/src/app/(app)/invoices/page.tsx — keep in sync.
 */
const WORD_EXPORT_TIERS = new Set(["confirmed_invoice", "likely_invoice"]);
function wordExportableCount(
  visibleInvoices: Array<{ reportStatus: "INCLUDED" | "EXCLUDED"; classificationTier: string }>,
  reportFacet: "INCLUDED" | "EXCLUDED"
): number {
  return visibleInvoices.filter(
    (inv) =>
      inv.reportStatus === reportFacet &&
      WORD_EXPORT_TIERS.has(inv.classificationTier)
  ).length;
}

describe("Word export gating counts confirmed/likely within the facet (FIX 5)", () => {
  test("For Review facet with only possible-tier rows disables Word", () => {
    const review = [
      { reportStatus: "EXCLUDED" as const, classificationTier: "possible_financial_email" },
      { reportStatus: "EXCLUDED" as const, classificationTier: "not_invoice" },
    ];
    // The old gating used reviewCount (2) → Word enabled → 400 on export.
    expect(review.length).toBe(2);
    // The fixed gating finds no confirmed/likely rows → Word disabled.
    expect(wordExportableCount(review, "EXCLUDED")).toBe(0);
  });

  test("For Review facet WITH a manually-excluded confirmed row enables Word", () => {
    const review = [
      { reportStatus: "EXCLUDED" as const, classificationTier: "possible_financial_email" },
      { reportStatus: "EXCLUDED" as const, classificationTier: "confirmed_invoice" },
    ];
    expect(wordExportableCount(review, "EXCLUDED")).toBe(1);
  });

  test("Report facet counts only confirmed/likely, ignoring possible rows", () => {
    const report = [
      { reportStatus: "INCLUDED" as const, classificationTier: "confirmed_invoice" },
      { reportStatus: "INCLUDED" as const, classificationTier: "likely_invoice" },
      // A possible row that somehow sits INCLUDED still isn't Word-exportable.
      { reportStatus: "INCLUDED" as const, classificationTier: "possible_financial_email" },
    ];
    expect(wordExportableCount(report, "INCLUDED")).toBe(2);
  });

  test("rows outside the current facet never count", () => {
    const mixed = [
      { reportStatus: "INCLUDED" as const, classificationTier: "confirmed_invoice" },
      { reportStatus: "EXCLUDED" as const, classificationTier: "confirmed_invoice" },
    ];
    // In the review facet only the EXCLUDED confirmed row counts.
    expect(wordExportableCount(mixed, "EXCLUDED")).toBe(1);
    // In the report facet only the INCLUDED confirmed row counts.
    expect(wordExportableCount(mixed, "INCLUDED")).toBe(1);
  });
});
