import Link from "next/link";
import {
  ScanSearch,
  Plus,
  Mail,
  CheckCircle2,
  Loader2,
  XCircle,
  Clock,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { requireOrganization } from "@/lib/session";
import { getScans, recoverStuckScans } from "@/lib/data/scans";
import { getConnections } from "@/lib/data/connections";
import { NewScanButton } from "./new-scan-button";
import { LocalTime } from "@/components/shared/local-time";
import { ScanProgress } from "./scan-progress";

const statusConfig = {
  PENDING: { icon: Clock, label: "Pending", variant: "outline" as const },
  RUNNING: { icon: Loader2, label: "Running", variant: "default" as const },
  COMPLETED: {
    icon: CheckCircle2,
    label: "Completed",
    variant: "secondary" as const,
  },
  FAILED: { icon: XCircle, label: "Failed", variant: "destructive" as const },
  CANCELLED: { icon: XCircle, label: "Cancelled", variant: "outline" as const },
};

export default async function ScansPage() {
  const { organizationId } = await requireOrganization();
  // Recover any scans stuck in RUNNING for 15+ minutes before loading
  await recoverStuckScans(organizationId);
  const [scans, connections] = await Promise.all([
    getScans(organizationId),
    getConnections(organizationId),
  ]);

  const hasConnection = connections.length > 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Scans"
        description="Gmail inbox scans and their results"
      >
        {hasConnection && <NewScanButton />}
      </PageHeader>

      {!hasConnection && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <Mail className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">No Gmail account connected</p>
          <p className="text-xs text-muted-foreground">
            Your Gmail was connected during sign-in. If you see this, try signing
            out and signing in again.
          </p>
        </div>
      )}

      {scans.length > 0 ? (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {scans.map((scan) => {
            const config =
              statusConfig[scan.status as keyof typeof statusConfig] ??
              statusConfig.PENDING;
            const StatusIcon = config.icon;
            return (
              <Link
                key={scan.id}
                href={`/scans/${scan.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/8 border border-primary/12 shrink-0">
                    <ScanSearch className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {scan.connection.email}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {scan.keywords.length > 0
                        ? scan.keywords.join(", ")
                        : "All keywords"}{" "}
                      &middot; {scan.daysBack} days &middot;{" "}
                      <LocalTime date={scan.createdAt} />
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  {scan.status === "RUNNING" && (
                    <ScanProgress scanId={scan.id} compact />
                  )}
                  {scan.status === "COMPLETED" && (() => {
                    const { included, excluded } = scan._reportCounts;
                    const saved = included + excluded;
                    const filteredOut = (scan.processedCount ?? 0) - saved;
                    return (
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <span>{scan.totalMessages} scanned</span>
                        <span className="text-muted-foreground/40">&middot;</span>
                        {included > 0 && (
                          <span className="text-emerald-600">{included} included</span>
                        )}
                        {excluded > 0 && (
                          <>
                            {included > 0 && <span className="text-muted-foreground/40">&middot;</span>}
                            <span className="text-amber-600">{excluded} for review</span>
                          </>
                        )}
                        {filteredOut > 0 && (
                          <>
                            <span className="text-muted-foreground/40">&middot;</span>
                            <span className="text-muted-foreground/60">{filteredOut} filtered</span>
                          </>
                        )}
                        {included === 0 && excluded === 0 && (
                          <span>no invoices found</span>
                        )}
                      </span>
                    );
                  })()}
                  <Badge variant={config.variant}>
                    <StatusIcon
                      className={`h-3 w-3 mr-1 ${
                        scan.status === "RUNNING" ? "animate-spin" : ""
                      }`}
                    />
                    {config.label}
                  </Badge>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        hasConnection && (
          <EmptyState
            icon={ScanSearch}
            title="No scans yet"
            description="Run your first inbox scan to detect invoices and receipts."
          />
        )
      )}
    </div>
  );
}
