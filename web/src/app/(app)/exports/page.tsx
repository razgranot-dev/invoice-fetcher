import { Download, FileSpreadsheet, FileText, Images, Loader2, XCircle, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireOrganization } from "@/lib/session";
import { getExports } from "@/lib/data/exports";

const formatIcon = {
  CSV: FileSpreadsheet,
  WORD: FileText,
  ZIP_SCREENSHOTS: Images,
};

const formatLabel: Record<string, string> = {
  CSV: "CSV Spreadsheet",
  WORD: "Word Document",
  ZIP_SCREENSHOTS: "Screenshot Package",
};

const statusConfig: Record<string, { icon: typeof Clock; label: string; variant: "secondary" | "default" | "destructive" | "outline" }> = {
  PENDING: { icon: Clock, label: "Queued", variant: "outline" },
  PROCESSING: { icon: Loader2, label: "Generating...", variant: "default" },
  COMPLETED: { icon: CheckCircle2, label: "Ready", variant: "secondary" },
  FAILED: { icon: XCircle, label: "Failed", variant: "destructive" },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {exports.map((exp) => {
            const Icon = formatIcon[exp.format as keyof typeof formatIcon] || Download;
            const status = statusConfig[exp.status] ?? statusConfig.PENDING;
            const StatusIcon = status.icon;
            return (
              <div
                key={exp.id}
                className="flex items-center justify-between px-5 py-4 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/8 border border-secondary/12 shrink-0">
                    <Icon className="h-4 w-4 text-secondary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {formatLabel[exp.format] ?? exp.format} Export
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {exp.invoiceCount} invoices &middot;{" "}
                      {new Date(exp.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {exp.fileSize ? ` \u00b7 ${formatBytes(exp.fileSize)}` : ""}
                    </p>
                    {exp.status === "PROCESSING" && (exp as any).progress > 0 && (
                      <div className="flex items-center gap-2 mt-1">
                        <div className="h-1.5 flex-1 max-w-[200px] rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all"
                            style={{ width: `${(exp as any).progress}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium tabular-nums text-blue-600">
                          {(exp as any).progress}%
                        </span>
                        {(exp as any).progressMessage && (
                          <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                            {(exp as any).progressMessage}
                          </span>
                        )}
                      </div>
                    )}
                    {exp.status === "COMPLETED" && (exp as any).progressMessage && (exp as any).progressMessage !== "Complete" && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 max-w-md">
                        {(exp as any).progressMessage}
                      </p>
                    )}
                    {exp.status === "FAILED" && exp.errorMessage && (
                      <p className="text-xs text-destructive mt-0.5 truncate max-w-xs">
                        {exp.errorMessage}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 ml-4">
                  {exp.status === "COMPLETED" && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={`/api/exports/${exp.id}/download`}>
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
                    </Button>
                  )}
                  <Badge variant={status.variant}>
                    <StatusIcon className={`h-3 w-3 mr-1 ${exp.status === "PROCESSING" ? "animate-spin" : ""}`} />
                    {status.label}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
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
