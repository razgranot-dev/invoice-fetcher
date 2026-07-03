/**
 * Frontend selection→payload contract. The 2026-05-28 incident lived entirely
 * in the client (selection never reached the API) and had NO test there — this
 * file closes that gap. If buildExportPayload stops sending invoiceIds for a
 * non-empty selection, these fail.
 */
import { describe, test, expect } from "vitest";
import {
  buildExportPayload,
  buildCsvExportRequest,
  exportReportStatus,
  exportStartMessage,
  missingSelectionWarning,
  nextPollDelay,
  mapDownloadFailure,
  filenameFromContentDisposition,
} from "../export-payload";

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

  test("H11: the legacy includeScreenshots flag is GONE from the payload", () => {
    // Screenshots ship only via the dedicated ZIP_SCREENSHOTS format; the
    // worker ignores (and warns on) the old flag. The payload must not
    // resurrect it.
    const p = buildExportPayload({ format: "WORD", filters: {}, selectedIds: ["c_a"] });
    expect("includeScreenshots" in p).toBe(false);
    expect(Object.keys(p).sort()).toEqual(["filters", "format", "invoiceIds"]);
  });
});

describe("buildCsvExportRequest — selection rides in a POST body (H9)", () => {
  test("a select-all-sized selection (2000 CUIDs) becomes a POST body, never a URL", () => {
    const ids = Array.from(
      { length: 2000 },
      (_, i) => `ckxyz1234567890abcdef${String(i).padStart(5, "0")}`
    );
    const req = buildCsvExportRequest(ids, "reportStatus=INCLUDED");
    expect(req.mode).toBe("selection");
    if (req.mode !== "selection") return;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/api/invoices/export");
    expect(req.body.ids).toHaveLength(2000);
    // The ids must NOT leak into the URL — that's the 16KB-header bug.
    expect(req.url).not.toContain("ids=");
  });

  test("no selection ⇒ filter-mode GET with the base query", () => {
    const req = buildCsvExportRequest([], "tier=confirmed_invoice&reportStatus=EXCLUDED");
    expect(req).toEqual({
      mode: "filters",
      method: "GET",
      url: "/api/invoices/export?tier=confirmed_invoice&reportStatus=EXCLUDED",
    });
  });

  test("null selection ⇒ filter-mode; duplicate ids are collapsed", () => {
    expect(buildCsvExportRequest(null, "a=b").mode).toBe("filters");
    const req = buildCsvExportRequest(["c_a", "c_a", "", "c_b"], "a=b");
    expect(req.mode).toBe("selection");
    if (req.mode === "selection") {
      expect(req.body.ids).toEqual(["c_a", "c_b"]);
    }
  });
});

describe("exportReportStatus — export the facet the screen shows (M16)", () => {
  test("For Review view (?report=EXCLUDED) exports the review set", () => {
    expect(exportReportStatus("EXCLUDED")).toBe("EXCLUDED");
  });

  test("default / missing / garbage report param exports the report set", () => {
    expect(exportReportStatus(undefined)).toBe("INCLUDED");
    expect(exportReportStatus(null)).toBe("INCLUDED");
    expect(exportReportStatus("")).toBe("INCLUDED");
    expect(exportReportStatus("INCLUDED")).toBe("INCLUDED");
    expect(exportReportStatus("garbage")).toBe("INCLUDED");
  });
});

describe("exportStartMessage — progress card vocabulary (S6)", () => {
  test("selection-mode mirrors the worker's 'Exporting N selected invoices' wording", () => {
    expect(exportStartMessage("WORD", 3)).toBe(
      "Exporting 3 selected invoices to Word..."
    );
    expect(exportStartMessage("ZIP_SCREENSHOTS", 1)).toBe(
      "Exporting 1 selected invoice to screenshots ZIP..."
    );
  });

  test("filter-mode keeps the generic starting labels", () => {
    expect(exportStartMessage("WORD", 0)).toBe("Starting Word export...");
    expect(exportStartMessage("ZIP_SCREENSHOTS", 0)).toBe(
      "Starting screenshot package..."
    );
  });
});

describe("missingSelectionWarning — part of the selection no longer exists (S6)", () => {
  test("warns with the missing count", () => {
    expect(missingSelectionWarning(5, 3)).toBe(
      "2 selected invoices no longer exist and will be skipped"
    );
    expect(missingSelectionWarning(2, 1)).toBe(
      "1 selected invoice no longer exists and will be skipped"
    );
  });

  test("silent when nothing is missing or in filter-mode", () => {
    expect(missingSelectionWarning(3, 3)).toBeUndefined();
    expect(missingSelectionWarning(0, 0)).toBeUndefined();
    // exported > selected is the route's invariant-violation path, not a warning
    expect(missingSelectionWarning(2, 5)).toBeUndefined();
  });
});

describe("nextPollDelay — polling backoff (S8)", () => {
  test("unchanged polls grow ×1.5 up to the 10s cap", () => {
    let d = 2000;
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      d = nextPollDelay(d, 2000, false);
      seen.push(d);
    }
    expect(seen).toEqual([3000, 4500, 6750, 10000, 10000, 10000]);
  });

  test("any observed change snaps back to the base delay", () => {
    expect(nextPollDelay(10000, 800, true)).toBe(800);
    expect(nextPollDelay(1200, 800, false)).toBe(1800);
  });

  test("respects a custom cap", () => {
    expect(nextPollDelay(4000, 2000, false, 5000)).toBe(5000);
  });
});

describe("mapDownloadFailure — expired vs retryable (M19)", () => {
  test("2xx is not a failure", () => {
    expect(mapDownloadFailure(200)).toBeNull();
    expect(mapDownloadFailure(204)).toBeNull();
  });

  test("410 means the worker-side file expired", () => {
    expect(mapDownloadFailure(410)).toBe("expired");
  });

  test("other failures (worker restart 502, 404, 500) are retryable errors", () => {
    expect(mapDownloadFailure(502)).toBe("error");
    expect(mapDownloadFailure(404)).toBe("error");
    expect(mapDownloadFailure(500)).toBe("error");
  });
});

describe("filenameFromContentDisposition", () => {
  test("parses quoted and unquoted filenames", () => {
    expect(
      filenameFromContentDisposition(
        'attachment; filename="invoices-2026-07-02.csv"',
        "fallback.csv"
      )
    ).toBe("invoices-2026-07-02.csv");
    expect(
      filenameFromContentDisposition(
        "attachment; filename=report.docx",
        "fallback.docx"
      )
    ).toBe("report.docx");
  });

  test("falls back when the header is missing or unparsable", () => {
    expect(filenameFromContentDisposition(null, "fallback.csv")).toBe("fallback.csv");
    expect(filenameFromContentDisposition("attachment", "fallback.csv")).toBe("fallback.csv");
  });
});
