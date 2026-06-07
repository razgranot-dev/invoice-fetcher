/**
 * Frontend selection→payload contract. The 2026-05-28 incident lived entirely
 * in the client (selection never reached the API) and had NO test there — this
 * file closes that gap. If buildExportPayload stops sending invoiceIds for a
 * non-empty selection, these fail.
 */
import { describe, test, expect } from "vitest";
import { buildExportPayload } from "../export-payload";

const FILTERS = { reportStatus: "INCLUDED", company: "PayPal" };

describe("buildExportPayload — selection overrides filters", () => {
  test("non-empty selection ⇒ invoiceIds present (selection-mode)", () => {
    const p = buildExportPayload({
      format: "WORD",
      filters: FILTERS,
      selectedIds: ["c_a", "c_b"],
    });
    expect(p.invoiceIds).toEqual(["c_a", "c_b"]);
    expect(p.format).toBe("WORD");
  });

  test("ZIP carries the SAME selection semantics as Word", () => {
    const word = buildExportPayload({ format: "WORD", filters: FILTERS, selectedIds: ["c_a", "c_b"] });
    const zip = buildExportPayload({ format: "ZIP_SCREENSHOTS", filters: FILTERS, selectedIds: ["c_a", "c_b"] });
    expect(zip.invoiceIds).toEqual(word.invoiceIds);
  });

  test("empty selection ⇒ invoiceIds OMITTED (filter-mode)", () => {
    const p = buildExportPayload({ format: "WORD", filters: FILTERS, selectedIds: [] });
    expect(p.invoiceIds).toBeUndefined();
    expect(p.filters).toEqual(FILTERS);
  });

  test("null / undefined selection ⇒ filter-mode", () => {
    expect(buildExportPayload({ format: "WORD", filters: FILTERS, selectedIds: null }).invoiceIds).toBeUndefined();
    expect(buildExportPayload({ format: "WORD", filters: FILTERS, selectedIds: undefined }).invoiceIds).toBeUndefined();
  });

  test("dedupes and drops empties so the IN clause stays tight", () => {
    const p = buildExportPayload({
      format: "WORD",
      filters: FILTERS,
      selectedIds: ["c_a", "c_a", "", "c_b"],
    });
    expect(p.invoiceIds).toEqual(["c_a", "c_b"]);
  });

  test("includeScreenshots flag is passed through (default false)", () => {
    expect(buildExportPayload({ format: "WORD", filters: {}, selectedIds: ["c_a"] }).includeScreenshots).toBe(false);
    expect(buildExportPayload({ format: "WORD", filters: {}, selectedIds: ["c_a"], includeScreenshots: true }).includeScreenshots).toBe(true);
  });
});
