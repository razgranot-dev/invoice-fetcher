/**
 * Client-side export contract helpers. Extracted as pure functions so the
 * "selected IDs override filters" contract is unit-tested at the FRONTEND
 * boundary — the prior incident (selection silently ignored) lived entirely in
 * the client and had no test there.
 *
 * Contract:
 *   • A non-empty selection ⇒ `invoiceIds` is included (selection-mode). The
 *     server then exports exactly those rows and ignores filters.
 *   • An empty / null selection ⇒ `invoiceIds` is OMITTED (filter-mode).
 *   • IDs are de-duplicated and empties dropped so the SQL IN clause stays tight.
 *
 * The legacy `includeScreenshots` flag is GONE (H11): screenshots ship only
 * via the dedicated ZIP_SCREENSHOTS format; the worker ignores the old flag.
 */
export type ExportFormat = "WORD" | "ZIP_SCREENSHOTS";

export interface ExportPayload {
  format: ExportFormat;
  filters: Record<string, string | undefined>;
  invoiceIds?: string[];
}

function dedupeIds(selectedIds: string[] | null | undefined): string[] {
  return Array.from(
    new Set(
      (selectedIds ?? []).filter((id) => typeof id === "string" && id.length > 0)
    )
  );
}

export function buildExportPayload(opts: {
  format: ExportFormat;
  filters: Record<string, string | undefined>;
  selectedIds: string[] | null | undefined;
}): ExportPayload {
  const payload: ExportPayload = {
    format: opts.format,
    filters: opts.filters ?? {},
  };

  const ids = dedupeIds(opts.selectedIds);
  if (ids.length > 0) {
    payload.invoiceIds = ids;
  }
  return payload;
}

/**
 * CSV export request builder (H9). A large select-all selection can exceed
 * Node's 16KB header limit as a GET query string, so selection-mode is ALWAYS
 * a POST with the ids in the JSON body; filter-mode stays a plain GET URL so
 * the browser's native download flow is preserved.
 */
export type CsvExportRequest =
  | { mode: "selection"; method: "POST"; url: string; body: { ids: string[] } }
  | { mode: "filters"; method: "GET"; url: string };

export function buildCsvExportRequest(
  selectedIds: string[] | null | undefined,
  baseQuery: string
): CsvExportRequest {
  const ids = dedupeIds(selectedIds);
  if (ids.length > 0) {
    return {
      mode: "selection",
      method: "POST",
      url: "/api/invoices/export",
      body: { ids },
    };
  }
  return {
    mode: "filters",
    method: "GET",
    url: `/api/invoices/export?${baseQuery}`,
  };
}

/**
 * The report-status facet the invoices page is currently showing (M16).
 * "Export by current filters" must export the set the user is LOOKING at:
 * the For Review view (?report=EXCLUDED) exports the review set, everything
 * else exports the report set.
 */
export function exportReportStatus(
  reportParam: string | null | undefined
): "INCLUDED" | "EXCLUDED" {
  return reportParam === "EXCLUDED" ? "EXCLUDED" : "INCLUDED";
}

/**
 * Initial progress-card message (S6). Mirrors the worker's
 * "Exporting N selected invoices..." vocabulary so the card reads the same
 * before and after the first server progress line arrives.
 */
export function exportStartMessage(
  format: ExportFormat,
  selectedCount: number
): string {
  if (selectedCount > 0) {
    const noun = selectedCount === 1 ? "invoice" : "invoices";
    const target = format === "WORD" ? "Word" : "screenshots ZIP";
    return `Exporting ${selectedCount} selected ${noun} to ${target}...`;
  }
  return format === "WORD"
    ? "Starting Word export..."
    : "Starting screenshot package...";
}

/**
 * Warning when part of an explicit selection no longer exists server-side
 * (S6) — e.g. rows deleted by a re-scan between selecting and exporting.
 * Returns undefined when nothing is missing (or in filter-mode, where
 * selectedCount is 0).
 */
export function missingSelectionWarning(
  selectedCount: number,
  exportedCount: number
): string | undefined {
  const missing = selectedCount - exportedCount;
  if (selectedCount <= 0 || missing <= 0) return undefined;
  return missing === 1
    ? "1 selected invoice no longer exists and will be skipped"
    : `${missing} selected invoices no longer exist and will be skipped`;
}

/**
 * Polling backoff (S8): unchanged polls stretch the delay ×1.5 up to the cap;
 * any observed change snaps back to the base so the progress bar stays live.
 */
export function nextPollDelay(
  currentDelayMs: number,
  baseDelayMs: number,
  changed: boolean,
  capMs = 10_000
): number {
  if (changed) return baseDelayMs;
  return Math.min(Math.round(currentDelayMs * 1.5), capMs);
}

/**
 * Classify a failed download response (M19): 410 means the file's TTL lapsed
 * (or predates a worker restart without persistence) → show an "Expired"
 * state; any other non-2xx is a transient/server error the user may retry.
 */
export function mapDownloadFailure(
  status: number
): "expired" | "error" | null {
  if (status >= 200 && status < 300) return null;
  if (status === 410) return "expired";
  return "error";
}

/** Parse the filename out of a Content-Disposition header, with fallback. */
export function filenameFromContentDisposition(
  header: string | null | undefined,
  fallback: string
): string {
  if (!header) return fallback;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  const name = match?.[1]?.trim();
  return name || fallback;
}

/**
 * Blob + programmatic-anchor download for fetch()-based export downloads
 * (POST CSV, exports-page Download). Browser-only — never call during SSR.
 */
export async function downloadResponseAsFile(
  res: Response,
  fallbackName: string
): Promise<void> {
  const blob = await res.blob();
  const filename = filenameFromContentDisposition(
    res.headers.get("content-disposition"),
    fallbackName
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
