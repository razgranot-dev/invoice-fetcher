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
        <div className="card-glow p-10 text-center animate-float-up">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-muted/30 border border-primary/15 mx-auto mb-5 shadow-xl shadow-primary/8 animate-glow-pulse orb-glow">
            <Mail className="h-7 w-7 text-primary/60" />
          </div>
          <p className="text-base font-bold text-foreground mb-1.5">No Gmail account connected</p>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
            Your Gmail was connected during sign-in. If you see this, try signing
            out and signing in again.
          </p>
        </div>
      )}

      {scans.length > 0 ? (
        <div className="card-glow divide-y divide-border/40 overflow-hidden">
          {scans.map((scan) => {
            const config =
              statusConfig[scan.status as keyof typeof statusConfig] ??
              statusConfig.PENDING;
            const StatusIcon = config.icon;
            return (
              <Link
                key={scan.id}
                href={`/scans/${scan.id}`}
                className="row-indicator flex items-center justify-between px-6 py-4.5 hover:bg-muted/30 transition-all duration-300 group"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/8 border border-primary/15 shrink-0 shadow-sm shadow-primary/5 group-hover:shadow-md group-hover:shadow-primary/10 transition-all duration-300 group-hover:scale-105">
                    <ScanSearch className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
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
                        <span className="text-border">&middot;</span>
                        {included > 0 && (
                          <span className="text-secondary font-semibold">{included} included</span>
                        )}
                        {excluded > 0 && (
                          <>
                            {included > 0 && <span className="text-border">&middot;</span>}
                            <span className="text-accent font-semibold">{excluded} for review</span>
                          </>
                        )}
                        {filteredOut > 0 && (
                          <>
                            <span className="text-border">&middot;</span>
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
