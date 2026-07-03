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
