import { Suspense } from "react";
import { FileText, Download } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { requireOrganization } from "@/lib/session";
import { getInvoices, getCompanyList, getScanListForFilter } from "@/lib/data/invoices";
import { getSuppliers } from "@/lib/data/suppliers";
import { normalizeDomain } from "@/lib/utils";
import { InvoiceFilters } from "./filters";
import { SupplierPanel } from "./supplier-panel";
import { InvoiceList } from "./invoice-list";
import { ExportWordButton } from "./export-word-button";

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

  const [allInvoices, companies, dbSuppliers, scanList] = await Promise.all([
    getInvoices(organizationId, filters),
    getCompanyList(organizationId),
    getSuppliers(organizationId),
    getScanListForFilter(organizationId),
  ]);

  const dbSupplierNames = new Set(dbSuppliers.map((s) => s.name.toLowerCase()));
  const extraSuppliers: typeof dbSuppliers = [];

  const invoiceBrandCounts = new Map<string, { displayName: string; count: number }>();
  for (const inv of allInvoices) {
    const brand = inv.company?.trim().toLowerCase()
      || (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null);
    if (!brand) continue;
    const entry = invoiceBrandCounts.get(brand);
    if (entry) {
      entry.count++;
    } else {
      const display = inv.company?.trim() || brand;
      invoiceBrandCounts.set(brand, { displayName: display, count: 1 });
    }
  }

  for (const [brand, { displayName, count }] of invoiceBrandCounts) {
    if (!dbSupplierNames.has(brand)) {
      extraSuppliers.push({
        id: `derived-${brand}`,
        name: brand,
        isRelevant: true,
        invoiceCount: count,
        organizationId,
        createdAt: new Date(),
      } as any);
      dbSupplierNames.add(brand);
    }
  }

  const allSuppliers = [...dbSuppliers, ...extraSuppliers];

  const excludedBrands = new Set(
    allSuppliers
      .filter((s) => !s.isRelevant)
      .map((s) => s.name.toLowerCase())
  );

  const visibleInvoices =
    excludedBrands.size > 0
      ? allInvoices.filter((inv) => {
          const brand = inv.company?.trim().toLowerCase()
            || (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null);
          if (brand && excludedBrands.has(brand)) return false;
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
  );
}
