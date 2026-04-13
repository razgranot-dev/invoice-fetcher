import { Download, FileText } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { requireOrganization } from "@/lib/session";
import { getExports } from "@/lib/data/exports";
import { ExportList } from "./export-list";

export default async function ExportsPage() {
  const { organizationId } = await requireOrganization();
  const exports = await getExports(organizationId);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Exports"
        description="Your exported invoice packages"
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/invoices">
            <FileText className="h-3.5 w-3.5" />
            New Export
          </Link>
        </Button>
      </PageHeader>

      {exports.length > 0 ? (
        <ExportList
          initial={exports.map((e) => ({
            id: e.id,
            format: e.format,
            status: e.status,
            invoiceCount: e.invoiceCount,
            progress: e.progress,
            progressMessage: e.progressMessage,
            fileSize: e.fileSize,
            errorMessage: e.errorMessage,
            createdAt: e.createdAt.toISOString(),
          }))}
        />
      ) : (
        <EmptyState
          icon={Download}
          title="No exports yet"
          description='Export your invoices as CSV or Word documents from the Invoices page using the "Export" buttons.'
        />
      )}
    </div>
  );
}
