/**
 * Regression guard for the 2026-05-28 "Word + Screenshots ignored selection"
 * incident.
 *
 * Symptom: user checked 2 specific invoices on the Invoices page, clicked
 * "Word + Screenshots" (the Word + Screenshots ZIP multi-format export
 * triggered from `ExportWordButton`), and the generated Word file contained
 * the entire filter view instead of the 2 checked rows.
 *
 * Root cause: `ExportWordButton` POST /api/exports always sent only the
 * `filters` object; the user's checkbox `selected` Set in `InvoiceList` was
 * purely local component state and never reached the API. The server then
 * re-queried by filters and applied supplier exclusion + the WORD tier
 * whitelist, silently widening the export.
 *
 * Fix: ExportWordButton now snapshots `selectedIds` at click time and posts
 * it as `invoiceIds`. The API route validates and forwards this list to
 * `selectExportableInvoices`, which short-circuits supplier exclusion and
 * the tier whitelist when an explicit selection is provided. The tests
 * below pin that contract.
 */

import { describe, test, expect } from "vitest";
import {
  selectExportableInvoices,
  validateInvoiceIds,
  pruneSelection,
  stuckExportWhere,
  STUCK_EXPORT_THRESHOLD_MS,
  CLASSIFICATION_TIERS,
  VALID_TIERS,
  type InvoiceForExport,
} from "../export-selection";

const brandResolver = (inv: InvoiceForExport): string | null =>
  (inv.company?.trim().toLowerCase() || inv.senderDomain || null);

function inv(over: Partial<InvoiceForExport> & { id: string }): InvoiceForExport {
  return {
    company: null,
    senderDomain: null,
    classificationTier: "confirmed_invoice",
    reportStatus: "INCLUDED",
    ...over,
  };
}

describe("validateInvoiceIds", () => {
  test("undefined raw → undefined (no selection)", () => {
    expect(validateInvoiceIds(undefined)).toEqual({
      valid: true,
      invoiceIds: undefined,
    });
  });

  test("null raw → undefined (no selection)", () => {
    expect(validateInvoiceIds(null)).toEqual({
      valid: true,
      invoiceIds: undefined,
    });
  });

  test("empty array is normalised to undefined (no-selection)", () => {
    // Empty array means the user "selected nothing" — treat it the same as
    // not sending the field so the request behaves like filter-mode rather
    // than an explicit empty-selection mode (which would always 400).
    expect(validateInvoiceIds([])).toEqual({
      valid: true,
      invoiceIds: undefined,
    });
  });

  test("non-array → 400 error", () => {
    expect(validateInvoiceIds("cmd2abc1234567890abcdef")).toMatchObject({
      valid: false,
    });
    expect(validateInvoiceIds({})).toMatchObject({ valid: false });
    expect(validateInvoiceIds(42)).toMatchObject({ valid: false });
  });

  test("CUIDs pass; non-CUID strings rejected", () => {
    const okIds = [
      "ckxyz1234567890abcdefghijk",
      "cm0abc1234567890abcdef1234",
    ];
    expect(validateInvoiceIds(okIds)).toEqual({
      valid: true,
      invoiceIds: okIds,
    });

    expect(
      validateInvoiceIds(["ck-this-has-a-dash-but-otherwise-cuid-shape"])
    ).toMatchObject({ valid: false });
    expect(validateInvoiceIds(["short"])).toMatchObject({ valid: false });
    expect(validateInvoiceIds([""])).toMatchObject({ valid: false });
    expect(validateInvoiceIds(["x".repeat(200)])).toMatchObject({ valid: false });
  });

  test("non-string element rejected (defends against SQL injection)", () => {
    expect(
      validateInvoiceIds([{ "$ne": "" }, "ckxyz1234567890abcdefghijk"])
    ).toMatchObject({ valid: false });
  });

  test("duplicates are collapsed so the IN clause stays tight", () => {
    const dup = "ckxyz1234567890abcdefghijk";
    const result = validateInvoiceIds([dup, dup, dup]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.invoiceIds).toEqual([dup]);
    }
  });

  test("oversized payload rejected so a crafted body can't DoS the IN clause", () => {
    const big = Array(10001).fill("ckxyz1234567890abcdefghijk");
    expect(validateInvoiceIds(big)).toMatchObject({ valid: false });
  });
});

describe("selectExportableInvoices — selection-mode", () => {
  /** The bug being fixed. The user checks 2 rows; the export must contain
   *  exactly those 2, regardless of what else is in `invoices` or what
   *  filters/supplier rules say. */
  test("returns the input invoices verbatim when invoiceIds is provided", () => {
    const a = inv({ id: "c_a", company: "Anthropic" });
    const b = inv({ id: "c_b", company: "Apple" });
    const c = inv({ id: "c_c", company: "Google" });

    const result = selectExportableInvoices({
      invoices: [a, b], // route already constrained the query by IDs
      format: "WORD",
      invoiceIds: ["c_a", "c_b"],
      excludedBrands: new Set(["apple"]),
      brandResolver,
    });

    // Apple would normally be filtered out, but the user picked it.
    expect(result).toEqual([a, b]);
    expect(result.find((i) => i.id === "c_c")).toBeUndefined();
  });

  test("bulletproof: selection-mode drops any row NOT in invoiceIds even if upstream over-fetched", () => {
    // Simulate an upstream regression where getInvoices() returned extra rows.
    // selectExportableInvoices must still ship ONLY the user's picks.
    const a = inv({ id: "c_a", company: "Anthropic" });
    const b = inv({ id: "c_b", company: "Apple" });
    const stray = inv({ id: "c_stray", company: "ShouldNeverShip" });
    const result = selectExportableInvoices({
      invoices: [a, b, stray], // <- widened result set
      format: "WORD",
      invoiceIds: ["c_a", "c_b"],
      excludedBrands: new Set(),
      brandResolver,
    });
    expect(result.map((i) => i.id).sort()).toEqual(["c_a", "c_b"]);
    expect(result.find((i) => i.id === "c_stray")).toBeUndefined();
  });

  test("supplier exclusion does NOT override explicit selection (regression for the original bug)", () => {
    const picked = inv({ id: "c_picked", company: "ExcludedBrand" });
    const result = selectExportableInvoices({
      invoices: [picked],
      format: "WORD",
      invoiceIds: ["c_picked"],
      excludedBrands: new Set(["excludedbrand"]),
      brandResolver,
    });
    expect(result).toEqual([picked]);
  });

  test("tier whitelist does NOT override explicit selection (Word can include possible_financial_email when manually picked)", () => {
    // The WORD filter-mode path drops possible_financial_email. Selection-
    // mode must NOT — if the user checked the row, it ships.
    const weak = inv({
      id: "c_weak",
      company: "MaybeVendor",
      classificationTier: "possible_financial_email",
    });
    const result = selectExportableInvoices({
      invoices: [weak],
      format: "WORD",
      invoiceIds: ["c_weak"],
      excludedBrands: new Set(),
      brandResolver,
    });
    expect(result).toEqual([weak]);
  });

  test("EXCLUDED reportStatus does NOT override explicit selection", () => {
    const excluded = inv({
      id: "c_excluded",
      company: "Vendor",
      reportStatus: "EXCLUDED",
    });
    const result = selectExportableInvoices({
      invoices: [excluded],
      format: "WORD",
      invoiceIds: ["c_excluded"],
      excludedBrands: new Set(),
      brandResolver,
    });
    expect(result).toEqual([excluded]);
  });

  test("ZIP_SCREENSHOTS also honours explicit selection without widening", () => {
    const a = inv({ id: "c_a", company: "Anthropic" });
    const result = selectExportableInvoices({
      invoices: [a],
      format: "ZIP_SCREENSHOTS",
      invoiceIds: ["c_a"],
      excludedBrands: new Set(["anthropic"]),
      brandResolver,
    });
    expect(result).toEqual([a]);
  });

  test("cross-supplier selection: 1 invoice each from 3 different suppliers ships intact", () => {
    const a = inv({ id: "c_a", company: "Anthropic" });
    const b = inv({ id: "c_b", company: "Apple" });
    const c = inv({ id: "c_c", company: "Google" });
    const result = selectExportableInvoices({
      invoices: [a, b, c],
      format: "WORD",
      invoiceIds: ["c_a", "c_b", "c_c"],
      excludedBrands: new Set(["apple", "google"]),
      brandResolver,
    });
    expect(result.map((i) => i.id).sort()).toEqual(["c_a", "c_b", "c_c"]);
  });
});

describe("selectExportableInvoices — filter-mode (no selection)", () => {
  test("drops invoices whose canonical brand is excluded", () => {
    const a = inv({ id: "c_a", company: "Anthropic" });
    const b = inv({ id: "c_b", company: "SpamCo" });
    const result = selectExportableInvoices({
      invoices: [a, b],
      format: "WORD",
      invoiceIds: undefined,
      excludedBrands: new Set(["spamco"]),
      brandResolver,
    });
    expect(result.map((i) => i.id)).toEqual(["c_a"]);
  });

  test("WORD drops possible_financial_email; ZIP keeps it", () => {
    const weak = inv({
      id: "c_weak",
      company: "MaybeVendor",
      classificationTier: "possible_financial_email",
    });
    const strong = inv({ id: "c_strong", company: "RealVendor" });

    const wordResult = selectExportableInvoices({
      invoices: [weak, strong],
      format: "WORD",
      invoiceIds: undefined,
      excludedBrands: new Set(),
      brandResolver,
    });
    expect(wordResult.map((i) => i.id)).toEqual(["c_strong"]);

    const zipResult = selectExportableInvoices({
      invoices: [weak, strong],
      format: "ZIP_SCREENSHOTS",
      invoiceIds: undefined,
      excludedBrands: new Set(),
      brandResolver,
    });
    expect(zipResult.map((i) => i.id).sort()).toEqual(["c_strong", "c_weak"]);
  });

  test("empty excludedBrands set leaves invoices untouched", () => {
    const a = inv({ id: "c_a", company: "Anthropic" });
    const result = selectExportableInvoices({
      invoices: [a],
      format: "WORD",
      invoiceIds: undefined,
      excludedBrands: new Set(),
      brandResolver,
    });
    expect(result).toEqual([a]);
  });
});

describe("selection-mode end-to-end semantics", () => {
  /** Composition test: validate then select, mimicking the route. The
   *  acceptance flow the user described: "select only 2 specific invoices,
   *  click Word + Screenshots, only those 2 ship." */
  test("acceptance: 2 picked rows from a 5-row view → exactly 2 in the export", () => {
    const allFive = [
      inv({ id: "ckxyz1234567890abcdefghi01", company: "Anthropic" }),
      inv({ id: "ckxyz1234567890abcdefghi02", company: "Apple" }),
      inv({ id: "ckxyz1234567890abcdefghi03", company: "Google" }),
      inv({ id: "ckxyz1234567890abcdefghi04", company: "Microsoft" }),
      inv({ id: "ckxyz1234567890abcdefghi05", company: "Stripe" }),
    ];

    const userPicked = ["ckxyz1234567890abcdefghi02", "ckxyz1234567890abcdefghi04"];
    const validation = validateInvoiceIds(userPicked);
    expect(validation.valid).toBe(true);
    if (!validation.valid) return;

    // The route's getInvoices() call would have applied { id: { in: [...] }
    // }, narrowing the result to those two rows before this point.
    const queriedInvoices = allFive.filter((i) =>
      validation.invoiceIds!.includes(i.id)
    );

    const result = selectExportableInvoices({
      invoices: queriedInvoices,
      format: "WORD",
      invoiceIds: validation.invoiceIds,
      // Even with aggressive exclusion config, the user's manual choice wins.
      excludedBrands: new Set(["apple", "microsoft"]),
      brandResolver,
    });

    expect(result.map((i) => i.id).sort()).toEqual(userPicked.sort());
  });
});

describe("pruneSelection — selection follows the visible list (M17)", () => {
  test("drops selected ids that are no longer visible", () => {
    const pruned = pruneSelection(new Set(["c_a", "c_b", "c_gone"]), ["c_a", "c_b", "c_other"]);
    expect(Array.from(pruned).sort()).toEqual(["c_a", "c_b"]);
  });

  test("an EMPTIED view clears the selection — invisible rows must not stay exportable", () => {
    // The M17 hole: InvoiceList unmounts when the view empties, so pruning
    // must happen in the always-mounted provider. An empty visibleIds array
    // must clear everything.
    const pruned = pruneSelection(new Set(["c_a", "c_b"]), []);
    expect(pruned.size).toBe(0);
  });

  test("returns the SAME Set reference when nothing needs pruning (no render loops)", () => {
    const selected = new Set(["c_a", "c_b"]);
    expect(pruneSelection(selected, ["c_a", "c_b", "c_c"])).toBe(selected);
  });

  test("empty selection short-circuits to the same reference", () => {
    const empty = new Set<string>();
    expect(pruneSelection(empty, [])).toBe(empty);
    expect(pruneSelection(empty, ["c_a"])).toBe(empty);
  });
});

describe("stuckExportWhere — orphaned-export recovery window (M20)", () => {
  test("covers BOTH lifecycle states, including pre-processing PENDING orphans", () => {
    // A row is created PENDING and only flips to PROCESSING inside the
    // after() callback. A process restart in between orphans it — and the
    // duplicate-export guard would then 429 that format forever.
    const now = new Date("2026-07-01T12:00:00Z");
    const where = stuckExportWhere("org_1", now);
    expect(where.organizationId).toBe("org_1");
    expect(where.status.in.sort()).toEqual(["PENDING", "PROCESSING"]);
    expect(where.createdAt.lt.getTime()).toBe(
      now.getTime() - STUCK_EXPORT_THRESHOLD_MS
    );
  });

  test("threshold is 15 minutes", () => {
    expect(STUCK_EXPORT_THRESHOLD_MS).toBe(15 * 60 * 1000);
  });
});

describe("CLASSIFICATION_TIERS — the shared tier enum", () => {
  test("contains exactly the tiers the worker produces (core/invoice_classifier.py)", () => {
    expect(new Set(CLASSIFICATION_TIERS)).toEqual(
      new Set([
        "confirmed_invoice",
        "likely_invoice",
        "possible_financial_email",
        "not_invoice",
      ])
    );
  });

  test("accepts the UI's 'Possible' value and rejects the stale copy-paste value", () => {
    // Regression: three routes once validated against a hand-rolled set
    // containing "possible_invoice" (which nothing produces), so filtering by
    // "Possible" 400'd Word exports and silently widened CSV exports.
    expect(VALID_TIERS.has("possible_financial_email")).toBe(true);
    expect(VALID_TIERS.has("possible_invoice")).toBe(false);
  });
});
