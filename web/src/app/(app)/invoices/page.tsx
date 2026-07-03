import { Suspense } from "react";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { requireOrganization } from "@/lib/session";
import { getInvoices, getScanListForFilter, getSupplierKeyCounts } from "@/lib/data/invoices";
import { getSuppliers } from "@/lib/data/suppliers";
import { canonicalSupplierKey, canonicalDisplayName, UNKNOWN_KEY } from "@/lib/supplier-canonical";
import { InvoiceFilters } from "./filters";
import { SupplierPanel } from "./supplier-panel";
import { InvoiceList } from "./invoice-list";
import { ExportWordButton } from "./export-word-button";
import { ExportCsvButton } from "./export-csv-button";
import { InvoiceSelectionProvider } from "./selection-context";
import { exportReportStatus } from "@/lib/export-payload";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    tier?: string;
    company?: string;
    report?: string;
    scan?: string;
  }>;
}) {
  const { organizationId } = await requireOrganization();
  const params = await searchParams;

  const filters = {
    search: params.search,
    tier: params.tier,
    company: params.company,
    reportStatus: params.report,
    scanId: params.scan || undefined,
  };

  const [allInvoices, dbSuppliers, scanList, invoiceBrandCounts] = await Promise.all([
    // Bumped from the 500 default so the on-screen list doesn't lag far behind
    // the dashboard total. Supplier completeness no longer depends on this (it
    // uses the uncapped aggregate below).
    getInvoices(organizationId, filters, 2000),
    getSuppliers(organizationId),
    getScanListForFilter(organizationId),
    // Chip counts are scoped to the same DB-level facets as the visible list
    // (scan / tier / report status) so a chip never promises more rows than
    // the view can show (M14). Search stays client-side and is deliberately
    // NOT part of the count scope. Counts group on the persisted
    // Invoice.supplierKey (S1) with a canonical-resolver fallback for
    // not-yet-backfilled rows; unattributable rows bucket under "unknown".
    getSupplierKeyCounts(organizationId, {
      scanId: params.scan || undefined,
      tier: params.tier,
      reportStatus: params.report,
    }),
  ]);

  // Build supplier list FROM the current visible result set so the panel
  // only shows brands that actually have invoices in this view. Brands are
  // unified via canonicalSupplierKey() — the single resolver that writes
  // Invoice.supplierKey and backs the supplier panel, the company filter,
  // the chip-toggle cascade, and the supplier-exclusion sweep, so
  // "Anthropic" + "Anthropic, PBC" + "Claude Team" collapse into one
  // supplier chip with aggregated count.
  const dbSupplierByKey = new Map(dbSuppliers.map((s) => [s.name.toLowerCase(), s]));

  const allSuppliers = Array.from(invoiceBrandCounts.entries())
    .map(([key, count]) => {
      const persisted = dbSupplierByKey.get(key);
      return {
        id: persisted?.id ?? `derived-${key}`,
        name: key,
        // Honour persisted user preference; default to included for brand-new suppliers.
        isRelevant: persisted ? persisted.isRelevant : true,
        invoiceCount: count,
        organizationId,
        createdAt: persisted?.createdAt ?? new Date(),
      } as (typeof dbSuppliers)[number];
    })
    .sort((a, b) => canonicalDisplayName(a.name).localeCompare(canonicalDisplayName(b.name)));

  // Company filter dropdown — one entry per canonical supplier. The option
  // VALUE is the canonical key (what getInvoices filters supplierKey on);
  // the display name is only the label (M14).
  const companies = Array.from(invoiceBrandCounts.entries())
    .map(([key, count]) => ({ key, name: canonicalDisplayName(key), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const excludedKeys = new Set(
    allSuppliers
      .filter((s) => !s.isRelevant)
      .map((s) => s.name.toLowerCase())
  );

  const visibleInvoices =
    excludedKeys.size > 0
      ? allInvoices.filter((inv) => {
          // Persisted key first (S1); resolver fallback for legacy rows.
          // Empty resolution buckets under "unknown" so excluding the
          // Unknown chip actually hides unattributable rows (M12).
          const key =
            inv.supplierKey ||
            canonicalSupplierKey({
              company: inv.company,
              senderDomain: inv.senderDomain,
            }) ||
            UNKNOWN_KEY;
          return !excludedKeys.has(key);
        })
      : allInvoices;

  // "Export by current filters" must export the set the user is LOOKING at
  // (M16): the For Review view (?report=EXCLUDED) exports the review set,
  // every other view exports the report set.
  const reportFacet = exportReportStatus(params.report);

  const exportQuery = new URLSearchParams();
  if (params.search) exportQuery.set("search", params.search);
  if (params.tier) exportQuery.set("tier", params.tier);
  if (params.company) exportQuery.set("company", params.company);
  if (params.scan) exportQuery.set("scanId", params.scan);
  exportQuery.set("reportStatus", reportFacet);

  const serialized = visibleInvoices.map((inv) => ({
    id: inv.id,
    company: inv.company,
    subject: inv.subject,
    sender: inv.sender,
    amount: inv.amount,
    currency: inv.currency,
    date: inv.date ? new Date(inv.date).toISOString() : null,
    classificationTier: inv.classificationTier,
    classificationScore: inv.classificationScore,
    hasAttachment: inv.hasAttachment,
    reportStatus: inv.reportStatus,
  }));

  const includedCount = visibleInvoices.filter(
    (inv) => inv.reportStatus === "INCLUDED"
  ).length;
  const reviewCount = visibleInvoices.filter(
    (inv) => inv.reportStatus === "EXCLUDED"
  ).length;

  // Filter-mode export buttons are gated on the facet the view is showing:
  // in the For Review view the exportable set is the review rows (M16).
  const facetCount = reportFacet === "EXCLUDED" ? reviewCount : includedCount;

  // Word is gated separately (FIX 5). A filter-mode WORD export drops
  // everything outside the confirmed/likely tier whitelist (EXPORT_TIERS in
  // export-selection.ts), whereas CSV/ZIP keep the whole facet. The For
  // Review facet (report=EXCLUDED) is mostly possible/other-tier rows, so a
  // Word button gated on facetCount would enable then 400 "No invoices match".
  // Count only the confirmed/likely rows in the CURRENT facet so an enabled
  // Word button always has at least one exportable row.
  const WORD_EXPORT_TIERS = new Set(["confirmed_invoice", "likely_invoice"]);
  const wordExportableCount = visibleInvoices.filter(
    (inv) =>
      inv.reportStatus === reportFacet &&
      WORD_EXPORT_TIERS.has(inv.classificationTier)
  ).length;

  return (
    <InvoiceSelectionProvider visibleIds={serialized.map((inv) => inv.id)}>
      <div className="space-y-6">
        <PageHeader
          title="Invoices"
          description={`${visibleInvoices.length} results \u00b7 ${includedCount} in report${reviewCount > 0 ? ` \u00b7 ${reviewCount} for review` : ""}`}
        >
          <div className="flex gap-2">
            <ExportCsvButton
              baseQuery={exportQuery.toString()}
              disabled={facetCount === 0}
            />
            <ExportWordButton
              filters={{
                search: params.search,
                tier: params.tier,
                company: params.company,
                scanId: params.scan,
                reportStatus: reportFacet,
              }}
              disabled={wordExportableCount === 0}
            />
          </div>
        </PageHeader>

        <Suspense>
          <InvoiceFilters
            companies={companies}
            scans={scanList.map((s) => ({
              ...s,
              createdAt: s.createdAt.toISOString(),
            }))}
          />
          <SupplierPanel suppliers={allSuppliers} />
        </Suspense>

        {visibleInvoices.length > 0 ? (
          <InvoiceList invoices={serialized} />
        ) : (
          <EmptyState
            icon={FileText}
            title="No invoices found"
            description="Run a scan to detect invoices, or adjust your search filters."
          />
        )}
      </div>
    </InvoiceSelectionProvider>
  );
}
