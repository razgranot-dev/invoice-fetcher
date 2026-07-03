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

/**
 * The four classification tiers the worker actually produces
 * (core/invoice_classifier.py) and the filter UI sends. Single source of
 * truth for API-boundary validation — every route MUST validate `tier`
 * against this set instead of hand-rolling its own list. A stale copy once
 * contained the nonexistent value "possible_invoice", which made the
 * "Possible" filter 400 on Word exports and silently widen CSV exports.
 */
export const CLASSIFICATION_TIERS = [
  "confirmed_invoice",
  "likely_invoice",
  "possible_financial_email",
  "not_invoice",
] as const;

export type ClassificationTier = (typeof CLASSIFICATION_TIERS)[number];

export const VALID_TIERS: ReadonlySet<string> = new Set(CLASSIFICATION_TIERS);

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

/**
 * Prune a checkbox selection down to the ids still visible after a filter
 * change (M17). Returns the SAME Set reference when nothing needs pruning so
 * React state setters can bail out without re-rendering. An empty
 * `visibleIds` clears the selection — an emptied view must never keep
 * invisible rows exportable.
 */
export function pruneSelection(
  selected: Set<string>,
  visibleIds: readonly string[]
): Set<string> {
  if (selected.size === 0) return selected;
  const visible = new Set(visibleIds);
  let needsPrune = false;
  for (const id of selected) {
    if (!visible.has(id)) {
      needsPrune = true;
      break;
    }
  }
  if (!needsPrune) return selected;
  const next = new Set<string>();
  for (const id of selected) {
    if (visible.has(id)) next.add(id);
  }
  return next;
}

/**
 * Stuck-export recovery window (M20). Covers BOTH lifecycle states: a row is
 * created PENDING and only flips to PROCESSING inside the after() callback —
 * if the process dies in between, the orphaned PENDING row would otherwise
 * block every future export of that format with a 429, forever.
 */
export const STUCK_EXPORT_THRESHOLD_MS = 15 * 60 * 1000;

export function stuckExportWhere(
  organizationId: string,
  now: Date
): {
  organizationId: string;
  status: { in: ("PENDING" | "PROCESSING")[] };
  createdAt: { lt: Date };
} {
  return {
    organizationId,
    status: { in: ["PENDING", "PROCESSING"] },
    createdAt: { lt: new Date(now.getTime() - STUCK_EXPORT_THRESHOLD_MS) },
  };
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
