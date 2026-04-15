import {
  FileText,
  ScanSearch,
  Building2,
  TrendingUp,
  ArrowRight,
  Plus,
  Receipt,
  Mail,
  Sparkles,
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
          <Button size="sm" variant="glow">
            <Plus className="h-3.5 w-3.5" />
            New Scan
          </Button>
        </Link>
      </PageHeader>

      {hasData ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
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
          <div className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm overflow-hidden shadow-lg shadow-black/5">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 border border-primary/15">
                  <FileText className="h-3.5 w-3.5 text-primary" />
                </div>
                <h2 className="text-sm font-semibold">Recent Invoices</h2>
              </div>
              <Link
                href="/invoices"
                className="text-xs font-medium text-primary/80 hover:text-primary flex items-center gap-1.5 transition-colors group"
              >
                View all <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>
            <div className="divide-y divide-border/40">
              {recentInvoices.map((inv) => {
                const badge = tierBadge[inv.classificationTier] ?? tierBadge.not_invoice;
                return (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between px-6 py-3.5 hover:bg-muted/15 transition-colors duration-200"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {inv.company ?? inv.subject}
                      </p>
                      <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                        {inv.subject}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-4 shrink-0">
                      {inv.amount && (
                        <span className="text-sm font-mono font-semibold tabular-nums">
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
            <div className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm overflow-hidden shadow-lg shadow-black/5">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary/10 border border-secondary/15">
                    <ScanSearch className="h-3.5 w-3.5 text-secondary" />
                  </div>
                  <h2 className="text-sm font-semibold">Recent Scans</h2>
                </div>
                <Link
                  href="/scans"
                  className="text-xs font-medium text-primary/80 hover:text-primary flex items-center gap-1.5 transition-colors group"
                >
                  View all <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>
              <div className="divide-y divide-border/40">
                {recentScans.map((scan) => (
                  <div
                    key={scan.id}
                    className="flex items-center justify-between px-6 py-3.5 hover:bg-muted/15 transition-colors duration-200"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/8 border border-primary/12 shadow-sm shadow-primary/5">
                        <Mail className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {scan.connection.email}
                        </p>
                        <p className="text-xs text-muted-foreground/70">
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
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center animate-float-up">
          <div className="relative mb-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/40 border border-border/60 shadow-lg">
              <ScanSearch className="h-7 w-7 text-muted-foreground/60" />
            </div>
            <div className="absolute -inset-4 rounded-3xl bg-primary/5 blur-xl -z-10" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No scans yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-8 leading-relaxed">
            Your Gmail account is connected. Run your first scan to start detecting invoices automatically.
          </p>
          <Link href="/scans">
            <Button size="sm" variant="glow">
              <Sparkles className="h-3.5 w-3.5" />
              Start First Scan
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
