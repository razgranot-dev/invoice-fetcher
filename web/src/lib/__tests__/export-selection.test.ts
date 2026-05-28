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
