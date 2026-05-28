import { Suspense } from "react";
import { FileText, Download } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { requireOrganization } from "@/lib/session";
import { getInvoices, getScanListForFilter } from "@/lib/data/invoices";
import { getSuppliers } from "@/lib/data/suppliers";
import { canonicalSupplierKey, canonicalDisplayName } from "@/lib/supplier-canonical";
import { InvoiceFilters } from "./filters";
import { SupplierPanel } from "./supplier-panel";
import { InvoiceList } from "./invoice-list";
import { ExportWordButton } from "./export-word-button";
import { InvoiceSelectionProvider } from "./selection-context";

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

  const [allInvoices, dbSuppliers, scanList] = await Promise.all([
    getInvoices(organizationId, filters),
    getSuppliers(organizationId),
    getScanListForFilter(organizationId),
  ]);

  // Build supplier list FROM the current visible result set so the panel
  // only shows brands that actually have invoices in this view. Brands are
  // unified via canonicalSupplierKey() — that's the single function used by
  // invoice persistence, the supplier panel, the company filter, and the
  // supplier-exclusion sweep, so "Anthropic" + "Anthropic, PBC" + "Claude
  // Team" collapse into one supplier chip with aggregated count.
  const dbSupplierByKey = new Map(dbSuppliers.map((s) => [s.name.toLowerCase(), s]));

  const invoiceBrandCounts = new Map<string, { count: number }>();
  for (const inv of allInvoices) {
    const key = canonicalSupplierKey({
      company: inv.company,
      senderDomain: inv.senderDomain,
    });
    if (!key) continue;
    const entry = invoiceBrandCounts.get(key);
    if (entry) {
      entry.count++;
    } else {
      invoiceBrandCounts.set(key, { count: 1 });
    }
  }

  const allSuppliers = Array.from(invoiceBrandCounts.entries())
    .map(([key, { count }]) => {
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

  // Company filter dropdown — one entry per canonical supplier, using the
  // human display name.
  const companies = Array.from(invoiceBrandCounts.entries())
    .map(([key, v]) => ({ name: canonicalDisplayName(key), count: v.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const excludedKeys = new Set(
    allSuppliers
      .filter((s) => !s.isRelevant)
      .map((s) => s.name.toLowerCase())
  );

  const visibleInvoices =
    excludedKeys.size > 0
      ? allInvoices.filter((inv) => {
          const key = canonicalSupplierKey({
            company: inv.company,
            senderDomain: inv.senderDomain,
          });
          if (key && excludedKeys.has(key)) return false;
          return true;
        })
      : allInvoices;

  const exportQuery = new URLSearchParams();
  if (params.search) exportQuery.set("search", params.search);
  if (params.tier) exportQuery.set("tier", params.tier);
  if (params.company) exportQuery.set("company", params.company);
  if (params.scan) exportQuery.set("scanId", params.scan);
  exportQuery.set("reportStatus", "INCLUDED");
  const exportUrl = `/api/invoices/export?${exportQuery.toString()}`;

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

  return (
    <InvoiceSelectionProvider>
      <div className="space-y-6">
        <PageHeader
          title="Invoices"
          description={`${visibleInvoices.length} results \u00b7 ${includedCount} included${reviewCount > 0 ? ` \u00b7 ${reviewCount} for review` : ""}`}
        >
          <div className="flex gap-2">
            {includedCount > 0 ? (
              <Button variant="outline" size="sm" asChild>
                <a href={exportUrl}>
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </a>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            )}
            <ExportWordButton
              filters={{
                search: params.search,
                tier: params.tier,
                company: params.company,
                scanId: params.scan,
                reportStatus: "INCLUDED",
              }}
              disabled={includedCount === 0}
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
