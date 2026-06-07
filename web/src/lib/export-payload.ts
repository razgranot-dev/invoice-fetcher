/**
 * Builds the POST body for /api/exports. Extracted as a pure function so the
 * "selected IDs override filters" contract is unit-tested at the FRONTEND
 * boundary — the prior incident (selection silently ignored) lived entirely in
 * the client and had no test there.
 *
 * Contract:
 *   • A non-empty selection ⇒ `invoiceIds` is included (selection-mode). The
 *     server then exports exactly those rows and ignores filters.
 *   • An empty / null selection ⇒ `invoiceIds` is OMITTED (filter-mode).
 *   • IDs are de-duplicated and empties dropped so the SQL IN clause stays tight.
 */
export type ExportFormat = "WORD" | "ZIP_SCREENSHOTS";

export interface ExportPayload {
  format: ExportFormat;
  filters: Record<string, string | undefined>;
  includeScreenshots: boolean;
  invoiceIds?: string[];
}

export function buildExportPayload(opts: {
  format: ExportFormat;
  filters: Record<string, string | undefined>;
  selectedIds: string[] | null | undefined;
  includeScreenshots?: boolean;
}): ExportPayload {
  const payload: ExportPayload = {
    format: opts.format,
    filters: opts.filters ?? {},
    includeScreenshots: opts.includeScreenshots === true,
  };

  const ids = Array.from(
    new Set((opts.selectedIds ?? []).filter((id) => typeof id === "string" && id.length > 0))
  );
  if (ids.length > 0) {
    payload.invoiceIds = ids;
  }
  return payload;
}
