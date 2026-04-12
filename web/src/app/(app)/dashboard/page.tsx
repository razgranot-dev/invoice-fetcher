import {
  FileText,
  ScanSearch,
  Building2,
  TrendingUp,
  ArrowRight,
  Plus,
  Receipt,
  Mail,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireOrganization } from "@/lib/session";
import { getDashboardData } from "@/lib/data/dashboard";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";

const tierBadge: Record<string, { label: string; variant: "secondary" | "default" | "accent" | "outline" }> = {
  confirmed_invoice: { label: "Confirmed", variant: "secondary" },
  likely_invoice: { label: "Likely", variant: "default" },
  possible_financial_email: { label: "Possible", variant: "accent" },
  not_invoice: { label: "Not Invoice", variant: "outline" },
};

export default async function DashboardPage() {
  const { organizationId } = await requireOrganization();
  const { stats, recentInvoices, recentScans } =
    await getDashboardData(organizationId);

  const hasData = stats.totalInvoices > 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Overview of your invoice processing"
      >
        <Link href="/scans">
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" />
            New Scan
          </Button>
        </Link>
      </PageHeader>

      {hasData ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Total Invoices"
              value={stats.totalInvoices.toLocaleString()}
              icon={FileText}
              accentColor="primary"
            />
            <StatCard
              label="This Month"
              value={stats.thisMonthInvoices.toString()}
              icon={TrendingUp}
              accentColor="secondary"
            />
            <StatCard
              label="Companies"
              value={stats.uniqueCompanies.toString()}
              icon={Building2}
              accentColor="accent"
            />
            <StatCard
              label="Total Amount"
              value={formatCurrency(stats.totalAmount)}
              subtitle="Confirmed + Likely"
              icon={Receipt}
              accentColor="primary"
            />
          </div>

          {/* Recent invoices */}
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold">Recent Invoices</h2>
              <Link
                href="/invoices"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="divide-y divide-border">
              {recentInvoices.map((inv) => {
                const badge = tierBadge[inv.classificationTier] ?? tierBadge.not_invoice;
                return (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between px-5 py-3 hover:bg-muted/20 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {inv.company ?? inv.subject}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {inv.subject}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-4 shrink-0">
                      {inv.amount && (
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

          {/* Recent scans */}
          {recentScans.length > 0 && (
            <div className="rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold">Recent Scans</h2>
                <Link
                  href="/scans"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="divide-y divide-border">
                {recentScans.map((scan) => (
                  <div
                    key={scan.id}
                    className="flex items-center justify-between px-5 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/8 border border-primary/12">
                        <Mail className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {scan.connection.email}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {scan.invoiceCount} invoices from{" "}
                          {scan.totalMessages} messages
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={
                        scan.status === "COMPLETED"
                          ? "secondary"
                          : scan.status === "RUNNING"
                          ? "default"
                          : "outline"
                      }
                    >
                      {scan.status === "COMPLETED"
                        ? "Done"
                        : scan.status === "RUNNING"
                        ? "Running"
                        : scan.status.toLowerCase()}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50 border border-border mb-5">
            <ScanSearch className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-semibold mb-1.5">No scans yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-6">
            Your Gmail account is connected. Run your first scan to start detecting invoices automatically.
          </p>
          <Link href="/scans">
            <Button size="sm">Start First Scan</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
