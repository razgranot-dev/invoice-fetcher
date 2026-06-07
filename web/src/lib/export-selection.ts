/**
 * Export selection logic — the decision of WHICH invoices end up in a
 * generated Word file / Screenshots ZIP.
 *
 * Pulled out of web/src/app/api/exports/route.ts so it can be exercised
 * by unit tests. The route imports `validateInvoiceIds` and
 * `selectExportableInvoices`; the rest of the route only handles I/O
 * (auth, DB reads, dispatch).
 *
 * The behavioural contract this module pins:
 *
 *   1. When the client sends an explicit `invoiceIds` array, that list IS
 *      the export. No tier whitelist, no supplier exclusion, no INCLUDED
 *      default — the user's manual checkbox choice is the source of truth.
 *
 *   2. When the client omits `invoiceIds`, the broad filter-mode behaviour
 *      kicks in: filter by supplier exclusion, and for WORD exports drop
 *      anything outside the confirmed/likely tier whitelist.
 *
 *   3. Invalid invoice IDs are rejected at the API boundary so a crafted
 *      payload can't widen the SQL `WHERE id IN (...)` clause.
 */

/** Match the CUID format Prisma generates for Invoice.id. */
const INVOICE_ID_RE = /^c[a-z0-9]{20,}$/i;

export interface SelectionValidationOk {
  valid: true;
  /** undefined ⇒ no selection sent. empty array ⇒ caller sent []
   *  (treated as no-selection so the request behaves like a plain
   *  filter-mode export). non-empty ⇒ selection-mode. */
  invoiceIds: string[] | undefined;
}

export interface SelectionValidationErr {
  valid: false;
  error: string;
}

export type SelectionValidationResult =
  | SelectionValidationOk
  | SelectionValidationErr;

export function validateInvoiceIds(
  raw: unknown,
  maxCount = 10000
): SelectionValidationResult {
  if (raw === undefined || raw === null) {
    return { valid: true, invoiceIds: undefined };
  }
  if (!Array.isArray(raw)) {
    return { valid: false, error: "invoiceIds must be an array" };
  }
  if (raw.length > maxCount) {
    return { valid: false, error: `Too many invoiceIds (max ${maxCount})` };
  }
  for (const id of raw) {
    if (typeof id !== "string" || id.length > 100 || !INVOICE_ID_RE.test(id)) {
      return { valid: false, error: "Invalid invoiceId in selection" };
    }
  }
  // Empty array is normalised to undefined so downstream code has a single
  // selection-mode predicate: `invoiceIds !== undefined`.
  if (raw.length === 0) {
    return { valid: true, invoiceIds: undefined };
  }
  return { valid: true, invoiceIds: Array.from(new Set(raw as string[])) };
}

export type ExportFormat = "WORD" | "ZIP_SCREENSHOTS";

export interface InvoiceForExport {
  id: string;
  company?: string | null;
  senderDomain?: string | null;
  classificationTier: string;
  reportStatus?: string | null;
}

export interface SelectInvoicesOpts<I extends InvoiceForExport> {
  invoices: I[];
  format: ExportFormat;
  invoiceIds: string[] | undefined;
  excludedBrands: Set<string>;
  brandResolver: (inv: I) => string | null;
}

/**
 * Decide which invoices end up in the generated export.
 *
 * Selection-mode (`invoiceIds` defined): return EXACTLY the rows whose id is in
 * the requested set — and nothing else. We intersect against `invoiceIds` here
 * (rather than trusting the caller to have constrained the query) so that even
 * if an upstream query regresses and over-fetches, the export can never widen
 * beyond the user's explicit checkbox choice. We deliberately do NOT re-apply
 * supplier-exclusion or the WORD tier whitelist — those would silently DROP
 * rows the user explicitly checked.
 *
 * Filter-mode (`invoiceIds` undefined): mirror the page's INCLUDED view by
 * dropping invoices whose canonical brand is in the excluded supplier set,
 * and (for Word) keeping only confirmed/likely-tier invoices.
 */
export function selectExportableInvoices<I extends InvoiceForExport>(
  opts: SelectInvoicesOpts<I>
): I[] {
  const { invoices, format, invoiceIds, excludedBrands, brandResolver } = opts;

  if (invoiceIds !== undefined) {
    // Bulletproof: selection is the source of truth. Intersect so a widened
    // upstream result set can never leak unselected rows into the export.
    const requested = new Set(invoiceIds);
    return invoices.filter((inv) => requested.has(inv.id));
  }

  const included =
    excludedBrands.size > 0
      ? invoices.filter((inv) => {
          const brand = brandResolver(inv);
          return !(brand && excludedBrands.has(brand));
        })
      : invoices;

  if (format === "ZIP_SCREENSHOTS") return included;

  const EXPORT_TIERS = new Set(["confirmed_invoice", "likely_invoice"]);
  return included.filter((inv) => EXPORT_TIERS.has(inv.classificationTier));
}
