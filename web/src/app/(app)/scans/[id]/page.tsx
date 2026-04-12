import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  XCircle,
  Clock,
  FileText,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { requireOrganization } from "@/lib/session";
import { getScanById } from "@/lib/data/scans";
import { formatCurrency } from "@/lib/utils";
import { notFound } from "next/navigation";
import Link from "next/link";

const statusConfig = {
  PENDING: { icon: Clock, label: "Pending", variant: "outline" as const },
  RUNNING: { icon: Loader2, label: "Running", variant: "default" as const },
  COMPLETED: { icon: CheckCircle2, label: "Completed", variant: "secondary" as const },
  FAILED: { icon: XCircle, label: "Failed", variant: "destructive" as const },
  CANCELLED: { icon: XCircle, label: "Cancelled", variant: "outline" as const },
};

const tierBadge: Record<string, { label: string; variant: "secondary" | "default" | "accent" | "outline" }> = {
  confirmed_invoice: { label: "Confirmed", variant: "secondary" },
  likely_invoice: { label: "Likely", variant: "default" },
  possible_financial_email: { label: "Possible", variant: "accent" },
  not_invoice: { label: "Not Invoice", variant: "outline" },
};

export default async function ScanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId } = await requireOrganization();
  const { id } = await params;
  const scan = await getScanById(organizationId, id);

  if (!scan) notFound();

  const config = statusConfig[scan.status as keyof typeof statusConfig] ?? statusConfig.PENDING;
  const StatusIcon = config.icon;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/scans"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-muted/50 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <PageHeader title="Scan Details" />
        <Badge variant={config.variant} className="ml-auto">
          <StatusIcon className={`h-3 w-3 mr-1 ${scan.status === "RUNNING" ? "animate-spin" : ""}`} />
          {config.label}
        </Badge>
      </div>

      {/* Scan metadata */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Account</p>
            <p className="font-medium mt-0.5">{scan.connection.email}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Messages scanned</p>
            <p className="font-medium mt-0.5">{scan.totalMessages}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Invoices found</p>
            <p className="font-medium mt-0.5">{scan.invoices.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Date</p>
            <p className="font-medium mt-0.5">
              {new Date(scan.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>

        {scan.errorMessage && (
          <div className="mt-4 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
            {scan.errorMessage}
          </div>
        )}
      </div>

      {/* Invoice results */}
      {scan.invoices.length > 0 ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">
              {scan.invoices.length} Invoice{scan.invoices.length !== 1 ? "s" : ""} Found
            </h2>
          </div>
          <div className="divide-y divide-border">
            {scan.invoices.map((inv) => {
              const badge = tierBadge[inv.classificationTier] ?? tierBadge.not_invoice;
              return (
                <div
                  key={inv.id}
                  className="flex items-center justify-between px-5 py-3 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 border border-border shrink-0">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {inv.company ?? inv.subject}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {inv.sender}
                        {inv.date &&
                          ` \u00b7 ${new Date(inv.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-4 shrink-0">
                    {inv.amount != null && (
                      <span className="text-sm font-mono tabular-nums">
                        {formatCurrency(inv.amount, inv.currency)}
                      </span>
                    )}
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        scan.status === "COMPLETED" && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No invoices detected in this scan.
          </div>
        )
      )}
    </div>
  );
}
