import { FileText, Download } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { requireOrganization } from "@/lib/session";
import { getInvoices, getCompanyList } from "@/lib/data/invoices";
import { getSuppliers } from "@/lib/data/suppliers";
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
  }>;
}) {
  const { organizationId } = await requireOrganization();
  const params = await searchParams;
  const [invoices, companies, suppliers] = await Promise.all([
    getInvoices(organizationId, {
      search: params.search,
      tier: params.tier,
      company: params.company,
      reportStatus: params.report,
    }),
    getCompanyList(organizationId),
    getSuppliers(organizationId),
  ]);

  // Exports always use INCLUDED only
  const exportQuery = new URLSearchParams();
  if (params.search) exportQuery.set("search", params.search);
  if (params.tier) exportQuery.set("tier", params.tier);
  if (params.company) exportQuery.set("company", params.company);
  exportQuery.set("reportStatus", "INCLUDED");
  const exportUrl = `/api/invoices/export?${exportQuery.toString()}`;

  // Serialize dates for client component
  const serialized = invoices.map((inv) => ({
    id: inv.id,
    company: inv.company,
    subject: inv.subject,
    sender: inv.sender,
    amount: inv.amount,
    currency: inv.currency,
    date: inv.date ? new Date(inv.date).toISOString() : null,
    classificationTier: inv.classificationTier,
    reportStatus: inv.reportStatus,
  }));

  const includedCount = invoices.filter(
    (inv) => inv.reportStatus === "INCLUDED"
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description={`${invoices.length} invoices found \u00b7 ${includedCount} in report`}
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
              reportStatus: "INCLUDED",
            }}
            disabled={includedCount === 0}
          />
        </div>
      </PageHeader>

      <InvoiceFilters companies={companies} />
      <SupplierPanel suppliers={suppliers} />

      {invoices.length > 0 ? (
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
