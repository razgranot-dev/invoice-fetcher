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
import { LocalTime } from "@/components/shared/local-time";
import { ScanProgress } from "../scan-progress";

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

      {/* Live progress for running scans */}
      {(scan.status === "RUNNING" || scan.status === "PENDING") && (
        <div className="rounded-xl border border-border bg-card p-5">
          <ScanProgress scanId={scan.id} />
        </div>
      )}

      {/* Scan metadata */}
      <div className="rounded-xl border border-border bg-card p-5">
        {(() => {
          const includedCount = scan.invoices.filter((i) => i.reportStatus === "INCLUDED").length;
          const reviewCount = scan.invoices.filter((i) => i.reportStatus === "EXCLUDED").length;
          const filteredOut = (scan.processedCount ?? 0) - scan.invoices.length;
          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Account</p>
                <p className="font-medium mt-0.5">{scan.connection.email}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Emails scanned</p>
                <p className="font-medium mt-0.5">{scan.totalMessages}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Included</p>
                <p className="font-medium mt-0.5 text-emerald-600">{includedCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">For review</p>
                <p className="font-medium mt-0.5 text-amber-600">{reviewCount}</p>
              </div>
              {filteredOut > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Filtered out</p>
                  <p className="font-medium mt-0.5 text-muted-foreground">{filteredOut}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Date</p>
                <p className="font-medium mt-0.5">
                  <LocalTime
                    date={scan.createdAt}
                    format={{ month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }}
                  />
                </p>
              </div>
            </div>
          );
        })()}

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
              {scan.invoices.length} Result{scan.invoices.length !== 1 ? "s" : ""} Saved
              {(() => {
                const inc = scan.invoices.filter((i) => i.reportStatus === "INCLUDED").length;
                const exc = scan.invoices.filter((i) => i.reportStatus === "EXCLUDED").length;
                const parts: string[] = [];
                if (inc > 0) parts.push(`${inc} included`);
                if (exc > 0) parts.push(`${exc} for review`);
                return parts.length > 0 ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}&mdash; {parts.join(", ")}
                  </span>
                ) : null;
              })()}
            </h2>
          </div>
          <div className="divide-y divide-border">
            {scan.invoices.map((inv) => {
              const badge = tierBadge[inv.classificationTier] ?? tierBadge.not_invoice;
              const isExcluded = inv.reportStatus === "EXCLUDED";
              // Derive review reason for borderline items
              let reviewTag = "";
              if (isExcluded) {
                if (inv.classificationTier === "possible_financial_email") {
                  if (inv.amount != null) reviewTag = "Payment signal";
                  else if (inv.hasAttachment) reviewTag = "PDF-only invoice";
                  else reviewTag = "Weak billing signal";
                } else if (inv.classificationTier === "not_invoice") {
                  reviewTag = "Insufficient content";
                }
              }
              return (
                <div
                  key={inv.id}
                  className={`flex items-center justify-between px-5 py-3 transition-colors ${
                    isExcluded ? "bg-muted/10 opacity-70" : "hover:bg-muted/20"
                  }`}
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
                        {inv.date && (
                          <>
                            {" \u00b7 "}
                            <LocalTime date={inv.date} format={{ month: "short", day: "numeric" }} />
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    {inv.amount != null && (
                      <span className="text-sm font-mono tabular-nums">
                        {formatCurrency(inv.amount, inv.currency)}
                      </span>
                    )}
                    {reviewTag && (
                      <span className="text-[10px] font-medium text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 px-1.5 py-0.5 rounded">
                        {reviewTag}
                      </span>
                    )}
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {isExcluded && (
                      <span className="text-[10px] text-muted-foreground">Needs review</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        scan.status === "COMPLETED" && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {(scan.processedCount ?? 0) > 0 ? (
              <>
                <p>No invoices met the inclusion threshold.</p>
                <p className="mt-1 text-xs">
                  {scan.processedCount} candidate{(scan.processedCount ?? 0) !== 1 ? "s" : ""} were
                  evaluated from {scan.totalMessages} emails but all were filtered out.
                </p>
              </>
            ) : (
              "No invoices detected in this scan."
            )}
          </div>
        )
      )}
    </div>
  );
}
